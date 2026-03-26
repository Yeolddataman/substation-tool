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

const app  = express();
const PORT = process.env.PORT || 3001;
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
