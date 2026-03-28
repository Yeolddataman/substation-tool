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
import { existsSync, readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import path from 'path';
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

// ── GET /api/fault-forecast ────────────────────────────────────────────────
// 3-day fault risk RAG per primary substation.
// Weather: Open-Meteo (free, no key). Risk model: weather score × historical
// fault-rate vulnerability (from NAFIRS fault history / feeder count).
// Cached server-side for 1 hour to avoid hammering Open-Meteo.

// 12 weather zones covering SEPD South England (4 cols × 3 rows)
const WEATHER_ZONES = [
  { lat: 50.65, lng: -1.80 }, // 0  W Hampshire / Dorset
  { lat: 50.65, lng: -0.75 }, // 1  C Hampshire / W Sussex
  { lat: 50.65, lng:  0.25 }, // 2  E Sussex
  { lat: 50.65, lng:  1.10 }, // 3  Kent coast
  { lat: 51.10, lng: -1.80 }, // 4  Wiltshire / N Hampshire
  { lat: 51.10, lng: -0.75 }, // 5  Surrey
  { lat: 51.10, lng:  0.25 }, // 6  West Kent
  { lat: 51.10, lng:  1.10 }, // 7  East Kent
  { lat: 51.55, lng: -1.80 }, // 8  N Wiltshire / Berkshire
  { lat: 51.55, lng: -0.75 }, // 9  Berkshire / N Surrey
  { lat: 51.55, lng:  0.25 }, // 10 N Kent / Medway
  { lat: 51.55, lng:  1.10 }, // 11 Thames Estuary
];

// ── ML Vulnerability Model ─────────────────────────────────────────────────
// Replaces hard percentile buckets with Z-score sigmoid regression.
// Train/test split by year: last 2 available years = hold-out test set.
// Backtest metric: Spearman rank correlation (predicted vuln vs actual test faults).

function spearmanR(x, y) {
  const n = x.length;
  if (n < 3) return null;
  const rank = arr => {
    const sorted = [...arr].map((v, i) => [v, i]).sort((a, b) => a[0] - b[0]);
    const r = new Array(n);
    sorted.forEach(([, i], ri) => (r[i] = ri + 1));
    return r;
  };
  const rx = rank(x), ry = rank(y);
  const d2 = rx.reduce((s, r, i) => s + (r - ry[i]) ** 2, 0);
  return 1 - (6 * d2) / (n * (n * n - 1));
}

function buildMLModel() {
  const data = JSON.parse(
    readFileSync(path.join(__dirname, '../public/headroom-substations.json'), 'utf8')
  );
  const primaries = data.filter(
    s => s.type === 'Primary' && s.nrn && s.faultsByYear &&
         Object.keys(s.faultsByYear).length >= 3
  );

  // Discover all years with data and split train/test
  const allYears = [...new Set(
    primaries.flatMap(s => Object.keys(s.faultsByYear))
  )].sort();
  const testYears  = allYears.slice(-2);
  const trainYears = allYears.slice(0, -2);

  const avgRate = (s, years) => {
    const vals = years.map(y => s.faultsByYear[y]).filter(v => v != null).map(Number);
    if (!vals.length) return null;
    return vals.reduce((a, b) => a + b, 0) / vals.length / Math.max(1, s.feederCount || 1);
  };

  // Build training set
  const trainSet = primaries
    .map(s => ({ nrn: s.nrn, lat: s.lat, lng: s.lng, rate: avgRate(s, trainYears) }))
    .filter(r => r.rate != null && r.rate >= 0);

  // Fit Z-score parameters from training data
  const rateVals = trainSet.map(r => r.rate);
  const mu  = rateVals.reduce((a, b) => a + b, 0) / rateVals.length;
  const sig = Math.sqrt(rateVals.reduce((a, b) => a + (b - mu) ** 2, 0) / rateVals.length) || 1;

  // Sigmoid maps z-score → [0, 1], scaled to vulnerability range [0.60, 1.50]
  const sigmoid  = z => 1 / (1 + Math.exp(-z));
  const toVuln   = rate => 0.60 + sigmoid((rate - mu) / sig) * 0.90;

  // Assign weather zone (nearest centroid)
  const nearestZone = (lat, lng) => {
    let minD = Infinity, zone = 0;
    WEATHER_ZONES.forEach((z, zi) => {
      const d = (z.lat - lat) ** 2 + (z.lng - lng) ** 2;
      if (d < minD) { minD = d; zone = zi; }
    });
    return zone;
  };

  const vulnMap = {};
  trainSet.forEach(r => {
    vulnMap[r.nrn] = { vuln: Math.round(toVuln(r.rate) * 1000) / 1000, zone: nearestZone(r.lat, r.lng) };
  });

  // ── Backtest 1: held-out test years ──────────────────────────────────────
  const testPairs = primaries
    .map(s => ({ nrn: s.nrn, testRate: avgRate(s, testYears) }))
    .filter(r => r.testRate != null && vulnMap[r.nrn]);
  const heldOutRho = spearmanR(testPairs.map(r => vulnMap[r.nrn].vuln), testPairs.map(r => r.testRate));

  // ── Backtest 2: leave-one-year-out cross-validation (more robust) ─────────
  // For each year: train on all other years, predict that year's fault rank.
  // This uses all 11 years and avoids reliance on any single split.
  const loyoRhos = allYears.map(holdYear => {
    const loYrTrain = allYears.filter(y => y !== holdYear);
    const pts = primaries
      .map(s => ({ s, rate: avgRate(s, loYrTrain) }))
      .filter(p => p.rate != null && p.rate >= 0);
    const loRates = pts.map(p => p.rate);
    const loMu  = loRates.reduce((a, b) => a + b, 0) / loRates.length;
    const loSig = Math.sqrt(loRates.reduce((a, b) => a + (b - loMu) ** 2, 0) / loRates.length) || 1;
    const loMap = {};
    pts.forEach(({ s, rate }) => { loMap[s.nrn] = 0.60 + sigmoid((rate - loMu) / loSig) * 0.90; });
    const loPairs = primaries
      .map(s => ({ v: loMap[s.nrn], r: avgRate(s, [holdYear]) }))
      .filter(p => p.v != null && p.r != null);
    return spearmanR(loPairs.map(p => p.v), loPairs.map(p => p.r));
  }).filter(r => r !== null);
  const loyoMean = loyoRhos.reduce((a, b) => a + b, 0) / loyoRhos.length;
  const loyoStd  = Math.sqrt(loyoRhos.reduce((a, b) => a + (b - loyoMean) ** 2, 0) / loyoRhos.length);

  // ── Signal: mean year-on-year persistence ρ ──────────────────────────────
  const persistRhos = [];
  for (let i = 0; i < allYears.length - 1; i++) {
    const yA = allYears[i], yB = allYears[i + 1];
    const pp = primaries
      .map(s => [avgRate(s, [yA]), avgRate(s, [yB])])
      .filter(([a, b]) => a != null && b != null);
    const r = spearmanR(pp.map(p => p[0]), pp.map(p => p[1]));
    if (r !== null) persistRhos.push(r);
  }
  const persistMean = persistRhos.reduce((a, b) => a + b, 0) / persistRhos.length;

  return {
    vulnMap,
    meta: {
      method: 'Z-score sigmoid regression',
      description: 'Fault-rate vulnerability learned from NAFIRS annual data. ' +
        'Each primary\'s average faults/feeder/year is Z-score normalised against ' +
        'the training population then mapped through a sigmoid to a continuous [0.60–1.50] ' +
        'multiplier. Validated via leave-one-year-out cross-validation across all 11 years.',
      trainYears,
      testYears,
      trainSize: trainSet.length,
      testSize: testPairs.length,
      // Primary metric: LOYO CV (unbiased, uses all years)
      loyoRho:    Math.round(loyoMean * 1000) / 1000,
      loyoStd:    Math.round(loyoStd  * 1000) / 1000,
      loyoFolds:  loyoRhos.length,
      // Secondary: single held-out split
      spearmanR:  heldOutRho !== null ? Math.round(heldOutRho * 100) / 100 : null,
      // Base signal
      persistenceRho: Math.round(persistMean * 1000) / 1000,
      mu:  Math.round(mu  * 10000) / 10000,
      sig: Math.round(sig * 10000) / 10000,
      weatherWeights: { wind: 55, rain: 25, snow: 20, temp: 10 },
      ragThresholds:  { yellow: 0.20, red: 0.45 },
    },
  };
}

// Weather risk factors — calibrated to UK overhead line fault drivers
const gf = g => g < 40 ? 0 : g < 55 ? 0.20 : g < 70 ? 0.50 : g < 85 ? 0.80 : 1.0; // wind gusts km/h
const rf = r => r < 5  ? 0 : r < 15 ? 0.15 : r < 30 ? 0.40 : 0.65;                 // rainfall mm/day
const sf = s => s < 0.5? 0 : s < 2  ? 0.30 : s < 5  ? 0.60 : 1.0;                  // snowfall cm/day
const tf = t => t > 30 ? 0.15 : t < -2 ? 0.20 : 0;                                  // temperature extremes
const wScore = (g, r, s, t) =>
  Math.min(1, gf(g) * 0.55 + rf(r) * 0.25 + sf(s) * 0.20 + tf(t) * 0.10);
const toRAG = score => score < 0.20 ? 'Green' : score < 0.45 ? 'Yellow' : 'Red';

let _forecastCache = null;
let _forecastTime  = 0;
let _model         = null;

async function refreshForecast() {
  if (!_model) _model = buildMLModel();
  const { vulnMap: _vulnMap, meta: modelMeta } = _model;

  const rawZoneData = await Promise.all(
    WEATHER_ZONES.map(z =>
      fetch(
        `https://api.open-meteo.com/v1/forecast?latitude=${z.lat}&longitude=${z.lng}` +
        `&daily=wind_gusts_10m_max,precipitation_sum,snowfall_sum,temperature_2m_max` +
        `&forecast_days=3&timezone=Europe%2FLondon`
      )
      .then(r => r.json())
      .catch(() => null)
    )
  );

  const validZone = rawZoneData.find(z => z?.daily?.time);
  if (!validZone) {
    const sample = JSON.stringify(rawZoneData[0]).slice(0, 200);
    throw new Error(`Open-Meteo returned no usable data. Sample: ${sample}`);
  }

  const zoneData    = rawZoneData.map(z => (z?.daily?.time ? z : validZone));
  const dates       = zoneData[0].daily.time;
  const days        = dates.map((d, i) => ({
    date:  d,
    label: i === 0 ? 'Today' : i === 1 ? 'Tomorrow'
      : new Date(d + 'T12:00:00Z').toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' }),
  }));
  const zoneWeather = zoneData.map(z =>
    z.daily.time.map((_, i) => ({
      gust: z.daily.wind_gusts_10m_max[i] ?? 0,
      rain: z.daily.precipitation_sum[i]  ?? 0,
      snow: z.daily.snowfall_sum[i]        ?? 0,
      tmax: z.daily.temperature_2m_max[i] ?? 15,
    }))
  );

  const primaries = {};
  for (const [nrn, { vuln, zone }] of Object.entries(_vulnMap)) {
    primaries[nrn] = {
      days: zoneWeather[zone].map(w => {
        const ws    = wScore(w.gust, w.rain, w.snow, w.tmax);
        const score = Math.round(Math.min(1, ws * vuln) * 100) / 100;
        return {
          rag:  toRAG(score),
          score,
          gust: Math.round(w.gust),
          rain: Math.round(w.rain * 10) / 10,
          snow: Math.round(w.snow * 10) / 10,
          tmax: Math.round(w.tmax * 10) / 10,
        };
      }),
      vuln: Math.round(vuln * 100) / 100,
      zone,
    };
  }

  _forecastCache = { generatedAt: new Date().toISOString(), days, primaries, modelMeta };
  _forecastTime  = Date.now();
  return _forecastCache;
}

app.get('/api/fault-forecast', requireAuth, async (_req, res) => {
  try {
    if (_forecastCache && Date.now() - _forecastTime < 60 * 60 * 1000) {
      return res.json(_forecastCache);
    }
    res.json(await refreshForecast());
  } catch (e) {
    res.status(502).json({ error: `Forecast unavailable: ${e.message}` });
  }
});

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

  // Warm forecast cache in the background so the first user request is instant
  refreshForecast()
    .then(() => console.log('   Forecast cache warmed ✓'))
    .catch(e  => console.warn(`   Forecast warm-up failed (will retry on first request): ${e.message}`));
  if (existsSync(DIST)) {
    console.log(`   Frontend    → http://localhost:${PORT}`);
  } else {
    console.log(`   Frontend    → run \`npm run dev\` (port 5173)`);
  }
  console.log('');
});
