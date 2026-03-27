// ── SSEN Substation Tool — Backend Server ────────────────────────────────
// Handles authentication and proxies Anthropic API calls so the API key
// is never exposed to the browser bundle.
//
// Usage:
//   npm run server           → production (serves dist/ + API on :3001)
//   npm run dev:server       → development with auto-restart
//
// Required .env vars (run `npm run setup-creds` to generate):
//   AUTH_USERNAME          → login username
//   AUTH_PASSWORD_HASH     → bcrypt hash of the password
//   JWT_SECRET             → random 48-byte hex secret for signing tokens
//   ANTHROPIC_API_KEY      → Anthropic API key (never sent to browser)

import 'dotenv/config';
import express from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { rateLimit } from 'express-rate-limit';
import { existsSync } from 'fs';
import { fileURLToPath } from 'url';
import path from 'path';
import https from 'https';

const app  = express();
const PORT = process.env.PORT || 3001;

// Railway (and most cloud platforms) sit behind a reverse proxy that sets
// X-Forwarded-For. Without this, express-rate-limit throws a validation error.
app.set('trust proxy', 1);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DIST = path.join(__dirname, '../dist');

// 10 MB limit to accommodate base64-encoded images in chat payloads
app.use(express.json({ limit: '10mb' }));

// ── Rate limiting ─────────────────────────────────────────────────────────
// Login: 10 attempts per hour per IP — slows brute-force attacks
const loginLimiter = rateLimit({
  windowMs:         60 * 60 * 1000, // 1 hour
  max:              10,
  standardHeaders: 'draft-7',
  legacyHeaders:   false,
  message:         { error: 'Too many login attempts. Please try again in an hour.' },
});

// Chat: 10 AI requests per hour per IP — prevents API key abuse
const chatLimiter = rateLimit({
  windowMs:         60 * 60 * 1000, // 1 hour
  max:              10,
  standardHeaders: 'draft-7',
  legacyHeaders:   false,
  message:         { error: 'Rate limit reached: 10 AI requests per hour. Please try again later.' },
});

// NERDA: 60 requests per 10 minutes — avoids hammering SSEN's API
// The frontend only fetches on tab open + caches, so real usage is much lower.
const nerdaLimiter = rateLimit({
  windowMs:         10 * 60 * 1000, // 10 minutes
  max:              60,
  standardHeaders: 'draft-7',
  legacyHeaders:   false,
  message:         { error: 'NERDA rate limit reached. Please wait a few minutes.' },
});

// ── Startup checks ────────────────────────────────────────────────────────
const REQUIRED = ['AUTH_USERNAME', 'AUTH_PASSWORD_HASH', 'JWT_SECRET'];
const missing  = REQUIRED.filter(k => !process.env[k]);
if (missing.length) {
  console.warn(`\n⚠  Missing .env vars: ${missing.join(', ')}`);
  console.warn('   Run: npm run setup-creds\n');
}

// ── POST /api/auth/login ─────────────────────────────────────────────────
// Returns a signed JWT valid for 8 hours.
// Always returns a generic error message regardless of which check failed
// to prevent username enumeration attacks.
app.post('/api/auth/login', loginLimiter, async (req, res) => {
  const { username = '', password = '' } = req.body || {};

  // Run bcrypt compare even on username mismatch to maintain constant-time response
  const dummyHash = '$2a$12$invalidhashinvalidhashinvalidhashinvalidhashinvalidhashi';
  const hashToCheck = username === process.env.AUTH_USERNAME
    ? process.env.AUTH_PASSWORD_HASH || dummyHash
    : dummyHash;

  const passwordOk  = await bcrypt.compare(password, hashToCheck);
  const usernameOk  = username === process.env.AUTH_USERNAME;

  if (!usernameOk || !passwordOk) {
    return res.status(401).json({ error: 'Invalid username or password.' });
  }

  const token = jwt.sign(
    { sub: username },
    process.env.JWT_SECRET,
    { expiresIn: '8h' }
  );

  res.json({ token, expiresIn: 28800 }); // 8h in seconds
});

// ── Auth middleware ───────────────────────────────────────────────────────
function requireAuth(req, res, next) {
  const auth = req.headers.authorization || '';
  if (!auth.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  try {
    req.user = jwt.verify(auth.slice(7), process.env.JWT_SECRET);
    next();
  } catch {
    res.status(401).json({ error: 'Session expired. Please log in again.' });
  }
}

// ── POST /api/chat ────────────────────────────────────────────────────────
// Proxies requests to Anthropic. The caller supplies their own API key via
// the X-Anthropic-Key header — it is used for this request only and is
// never logged, stored, or persisted anywhere on the server.
// JWT auth (requireAuth) ensures only logged-in users can reach this endpoint.
app.post('/api/chat', requireAuth, chatLimiter, async (req, res) => {
  const apiKey = req.headers['x-anthropic-key'];
  if (!apiKey || !apiKey.startsWith('sk-ant-')) {
    return res.status(400).json({ error: 'A valid Anthropic API key is required (X-Anthropic-Key header).' });
  }

  try {
    const upstream = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key':          apiKey,
        'anthropic-version':  '2023-06-01',
        'content-type':       'application/json',
      },
      body: JSON.stringify(req.body),
    });

    const data = await upstream.json();
    res.status(upstream.status).json(data);
  } catch (e) {
    res.status(502).json({ error: `Upstream error: ${e.message}` });
  }
});

// ── NERDA proxy ───────────────────────────────────────────────────────────
// Keeps the NERDA API key server-side. All requests are JWT-authenticated
// and rate-limited to avoid hammering SSEN's infrastructure.
//
// Auth per NERDA API guide (Phase 1 production):
//   Long-term key: GET request with {username, apiKey} as JSON body.
//   Short-term key: Authorization: Bearer <token> header.
// The JSON-body approach is tried first; Bearer is the fallback.
const NERDA_BASE = 'https://nerda-prod-apis-v2.azurewebsites.net/api';

const AUTH_FAIL = new Set([400, 401, 403, 502]);

// nerdaFetch(url, shortTermKey)
// shortTermKey: optional Bearer token copied from the NERDA portal (1h validity).
// If provided it is used directly. The server-side long-term key is a fallback
// for any future NERDA API changes that accept it.
async function nerdaFetch(url, shortTermKey) {
  const longKey  = process.env.NERDA_API_KEY;
  const username = process.env.NERDA_USERNAME;

  const log = (method, status) =>
    console.log(`[NERDA] auth=${method} → ${status}  ${url.split('?')[0]}`);

  // 1. Short-term portal key as Bearer (primary — only method NERDA data endpoints accept)
  if (shortTermKey) {
    const r = await fetch(url, {
      headers: { Authorization: `Bearer ${shortTermKey}`, Accept: 'application/json' },
    });
    log('short-term-bearer', r.status);
    if (!AUTH_FAIL.has(r.status)) return r;
  }

  // 2. Long-term key as GET with JSON body (per API guide; may work in future)
  if (username && longKey) {
    const statusAndText = await new Promise((resolve, reject) => {
      const bodyStr = JSON.stringify({ username, apiKey: longKey });
      const parsed  = new URL(url);
      const req = https.request({
        hostname: parsed.hostname,
        path:     parsed.pathname + parsed.search,
        method:   'GET',
        headers:  {
          'Content-Type':   'application/json',
          'Accept':         'application/json',
          'Content-Length': Buffer.byteLength(bodyStr),
        },
      }, res => {
        let data = '';
        res.on('data', chunk => { data += chunk; });
        res.on('end', () => resolve({ status: res.statusCode, text: data }));
      });
      req.on('error', reject);
      req.write(bodyStr);
      req.end();
    });
    log('long-term-body', statusAndText.status);
    if (!AUTH_FAIL.has(statusAndText.status)) {
      return {
        status: statusAndText.status,
        ok:     statusAndText.status >= 200 && statusAndText.status < 300,
        text:   () => Promise.resolve(statusAndText.text),
      };
    }
  }

  // 3. Long-term key directly as Bearer (last resort)
  const r = await fetch(url, {
    headers: { Authorization: `Bearer ${longKey}`, Accept: 'application/json' },
  });
  log('long-term-bearer', r.status);
  return r;
}

// GET /api/nerda/substations?uuid=...  → single substation by NERDA UUID
// GET /api/nerda/substations?name=...  → search by sds_site_id (preferred — avoids full-list 500)
// GET /api/nerda/substations           → all substations (likely 500 — avoid)
app.get('/api/nerda/substations', requireAuth, nerdaLimiter, async (req, res) => {
  const shortKey = req.headers['x-nerda-key'] || '';
  const { uuid, name } = req.query;
  const url = uuid ? `${NERDA_BASE}/ApiNerdaStatic?substation=${encodeURIComponent(uuid)}`
            : name ? `${NERDA_BASE}/ApiNerdaStatic?sds_site_id=${encodeURIComponent(name)}`
            : `${NERDA_BASE}/ApiNerdaStatic`;
  try {
    const upstream = await nerdaFetch(url, shortKey);
    const text = await upstream.text();
    console.log(`[NERDA] GET substations → ${upstream.status} (${text.length} bytes)`);
    try {
      res.status(upstream.status).json(JSON.parse(text));
    } catch {
      res.status(upstream.status).send(text);
    }
  } catch (e) {
    console.error(`[NERDA] substations fetch failed: ${e.message}`);
    res.status(502).json({ error: `NERDA network error: ${e.message}` });
  }
});

// GET /api/nerda/timeseries?measurement=...&after=...
// Returns measurement readings from `after` to now (last 12h)
app.get('/api/nerda/timeseries', requireAuth, nerdaLimiter, async (req, res) => {
  const shortKey = req.headers['x-nerda-key'] || '';
  const { measurement, after } = req.query;
  if (!measurement || !after) {
    return res.status(400).json({ error: 'measurement and after params required' });
  }
  const url = `${NERDA_BASE}/ApiNerdaAfter?measurement=${encodeURIComponent(measurement)}&after=${encodeURIComponent(after)}`;
  try {
    const upstream = await nerdaFetch(url, shortKey);
    const text = await upstream.text();
    console.log(`[NERDA] GET timeseries → ${upstream.status} (${text.length} bytes)`);
    try {
      res.status(upstream.status).json(JSON.parse(text));
    } catch {
      res.status(upstream.status).send(text);
    }
  } catch (e) {
    console.error(`[NERDA] timeseries fetch failed: ${e.message}`);
    res.status(502).json({ error: `NERDA network error: ${e.message}` });
  }
});

// ── GET /api/health ───────────────────────────────────────────────────────
app.get('/api/health', (_req, res) =>
  res.json({ status: 'ok', ts: new Date().toISOString() })
);

// ── Serve Vite production build ───────────────────────────────────────────
// In development, Vite runs its own dev server and proxies /api here.
// In production, Express serves the built frontend as static files.
if (existsSync(DIST)) {
  app.use(express.static(DIST));
  app.get('*', (_req, res) => res.sendFile(path.join(DIST, 'index.html')));
} else {
  app.get('/', (_req, res) => res.json({
    status: 'API server running (no frontend build found)',
    tip: 'Run `npm run build` then restart to serve the frontend.',
  }));
}

app.listen(PORT, () => {
  console.log(`\n⚡ SSEN Substation Tool`);
  console.log(`   API server  → http://localhost:${PORT}/api`);
  if (existsSync(DIST)) {
    console.log(`   Frontend    → http://localhost:${PORT}`);
  } else {
    console.log(`   Frontend    → run \`npm run dev\` (port 5173)`);
  }
  console.log('');
});
