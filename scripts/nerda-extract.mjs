#!/usr/bin/env node
/**
 * nerda-extract.mjs  (v3)
 *
 * NERDA API findings:
 *   - ApiNerdaStatic (no params) → always 500 (too large, no bulk listing)
 *   - ApiNerdaStatic?substation={uuid} → 200 with transformer+measurement data
 *   - No pagination, no name-filter support
 *   - UUIDs must come from NERDA portal URLs
 *
 * This script fetches data for all UUIDs provided in --uuid-map=file.json,
 * matches them to headroom primaries by name, and pulls last 10 min timeseries.
 *
 * uuid-map.json format:  { "SUBSTATION NAME": "uuid-here", ... }
 * Get UUIDs: log in to nerda.ssen.co.uk → navigate to a substation → copy UUID from URL
 *
 * Usage:
 *   node scripts/nerda-extract.mjs --key=JWT [--uuid-map=scripts/nerda-uuid-map.json]
 */

import { readFileSync, writeFileSync, existsSync } from 'fs';
import { createRequire } from 'module';
import https from 'https';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname  = path.dirname(fileURLToPath(import.meta.url));
const NERDA_BASE = 'https://nerda-prod-apis-v2.azurewebsites.net/api';
const DELAY_MS   = 800;   // ms between timeseries requests
const FULL_LIST_CACHE = path.join(__dirname, 'nerda-full-list.json');

// ── Args ──────────────────────────────────────────────────────────────────
const args = Object.fromEntries(
  process.argv.slice(2)
    .filter(a => a.startsWith('--'))
    .map(a => { const [k, ...v] = a.slice(2).split('='); return [k, v.join('=')]; })
);
const SHORT_KEY  = args.key || process.env.NERDA_SHORT_KEY || '';
const UUID_MAP_FILE = args['uuid-map'] || path.join(__dirname, 'nerda-uuid-map.json');
if (!SHORT_KEY) {
  console.error('\n❌  No short-term key.\n   Usage: node scripts/nerda-extract.mjs --key=YOUR_JWT\n');
  process.exit(1);
}

// ── HTTP helper (supports any method + body, long timeout) ─────────────────
function httpsReq(url, { timeoutMs = 120_000 } = {}) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const req = https.request({
      hostname: parsed.hostname,
      path:     parsed.pathname + parsed.search,
      method:   'GET',
      headers:  { Authorization: `Bearer ${SHORT_KEY}`, Accept: 'application/json' },
      timeout:  timeoutMs,
    }, res => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8');
        let json = null;
        try { json = JSON.parse(text); } catch { /* keep null */ }
        resolve({ status: res.statusCode, json, text });
      });
    });
    req.on('timeout', () => { req.destroy(); reject(new Error('TIMEOUT')); });
    req.on('error', reject);
    req.end();
  });
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

function normName(name = '') {
  return name.toUpperCase()
    .replace(/\s+(PRIMARY|GSP|BSP|SUBSTATION|GRID|SWITCHING STATION)$/, '')
    .replace(/[^A-Z0-9 ]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function parseValues(data) {
  const history =
    Array.isArray(data?.AnalogValues?.[0]?.value_history) ? data.AnalogValues[0].value_history
    : Array.isArray(data?.value_history)                  ? data.value_history
    : Array.isArray(data)                                 ? data
    : [];
  return history.map(p => ({ ts: p._ts || '', value: p.value ?? p.rms ?? null }))
                .filter(p => p.value != null);
}


// ── Extract measurements from confirmed NERDA structure ─────────────────────
// Actual response: Array of { transformers:[{tx_name, measurements:[...]}] }
function extractMeasurements(detail) {
  const out = [];
  const items = Array.isArray(detail) ? detail : [detail];
  for (const item of items) {
    for (const tx of item?.transformers || []) {
      for (const m of tx?.measurements || []) {
        if (!m.nerda_measurement_id) continue;
        if ((m.measurementType || '').toLowerCase() === 'switchposition') continue;
        out.push({ id: m.nerda_measurement_id, type: m.measurementType || '', unit: m.unitSymbol || '', mult: m.unitMultiplier || '', tx: tx.tx_name || '' });
      }
    }
  }
  return out;
}

// ── Main ──────────────────────────────────────────────────────────────────
async function main() {
  const require = createRequire(import.meta.url);
  const headroom = require('../public/headroom-substations.json');
  const primaries = headroom.filter(s => s.type === 'Primary');

  // Load UUID map (name → uuid) — must be built manually from NERDA portal
  let uuidMap = {};
  if (existsSync(UUID_MAP_FILE)) {
    uuidMap = JSON.parse(readFileSync(UUID_MAP_FILE, 'utf8'));
    console.log(`\n📡  NERDA Extract v3 — ${new Date().toISOString()}`);
    console.log(`    UUID map loaded: ${Object.keys(uuidMap).length} entries from ${UUID_MAP_FILE}`);
  } else {
    console.log(`\n📡  NERDA Extract v3 — ${new Date().toISOString()}`);
    console.warn(`    ⚠  No UUID map found at ${UUID_MAP_FILE}`);
    console.warn(`    Create it with: { "Substation Name": "nerda-uuid", ... }`);
    console.warn(`    UUIDs come from the NERDA portal URL when viewing a substation.\n`);
    console.warn(`    Running diagnostic probe only (1 known test UUID from API guide)...\n`);
  }

  // Always test with the known example UUID from the API guide
  const testUuids = {
    'Cowley Local BSP [API guide example]': '74f42299-9f8e-4cb4-922c-0e3273bff4c7',
    ...uuidMap,
  };

  const after = new Date(Date.now() - 10 * 60_000).toISOString();
  const results = [];
  let succeeded = 0, failed = 0, tsErrors = 0;

  console.log(`\n── Fetching ${Object.keys(testUuids).length} substations by UUID ──`);

  for (const [name, uuid] of Object.entries(testUuids)) {
    const row = { name, uuid, matched: false, measurements: [], sample: null, headroomMatch: null, error: null };

    // Match to headroom primary
    const normN = normName(name);
    const hMatch = primaries.find(p => normName(p.name) === normN);
    if (hMatch) row.headroomMatch = { id: hMatch.id, gsp: hMatch.upstreamGSP, voltage: hMatch.voltage };

    try {
      const stationR = await httpsReq(`${NERDA_BASE}/ApiNerdaStatic?substation=${encodeURIComponent(uuid)}`);
      if (stationR.status === 401 || stationR.status === 403) throw new Error(`AUTH_FAILED:${stationR.status}`);
      if (stationR.status !== 200 || !stationR.json) {
        failed++;
        row.error = `station ${stationR.status}`;
        console.log(`  ✗ ${name}  → ${stationR.status}`);
        results.push(row);
        continue;
      }

      row.matched = true;
      succeeded++;
      const meas = extractMeasurements(stationR.json);
      row.measurements = meas.map(m => ({ id: m.id, type: m.type, unit: m.unit, mult: m.mult, tx: m.tx }));
      console.log(`  ✓ ${name}  → ${meas.length} measurements`);

      // Fetch 10-min timeseries for first ThreePhaseActivePower or LineCurrent
      const primary = meas.find(m => m.type === 'ThreePhaseActivePower') || meas[0];
      if (primary) {
        await sleep(DELAY_MS);
        const tsR = await httpsReq(`${NERDA_BASE}/ApiNerdaAfter?measurement=${encodeURIComponent(primary.id)}&after=${encodeURIComponent(after)}`);
        if (tsR.status === 200 && tsR.json) {
          const values = parseValues(tsR.json);
          const multFactor = primary.mult === 'M' ? 1e6 : primary.mult === 'k' ? 1e3 : 1;
          // Convert to display units (W→MW, V→kV)
          const displayMult = primary.mult === 'M' ? 1 : primary.mult === 'k' ? 1 : 1;
          row.sample = {
            measurementId:   primary.id,
            measurementType: primary.type,
            rawUnit:         primary.unit,
            unitMultiplier:  primary.mult,
            readingCount:    values.length,
            latest:          values[values.length - 1] || null,
            latestValue:     values.length ? values[values.length - 1]?.value : null,
            minValue:        values.length ? Math.min(...values.map(v => v.value)) : null,
            maxValue:        values.length ? Math.max(...values.map(v => v.value)) : null,
          };
          const latest = row.sample.latestValue;
          const dispUnit = primary.mult === 'M' ? `M${primary.unit}` : primary.mult === 'k' ? `k${primary.unit}` : primary.unit;
          console.log(`     └ ${primary.type}: latest=${latest?.toFixed(2)} ${dispUnit}  (${values.length} readings, last 10 min)`);
        } else {
          tsErrors++;
          console.log(`     └ timeseries ${tsR.status}`);
        }
      }

    } catch (e) {
      if (e.message.startsWith('AUTH_FAILED')) {
        console.error('\n⛔  Auth failed — key expired. Stopping.\n'); process.exit(1);
      }
      failed++;
      row.error = e.message;
      console.log(`  ✗ ${name}  → ${e.message}`);
    }

    results.push(row);
    await sleep(DELAY_MS);
  }

  // ── Outputs ────────────────────────────────────────────────────────────
  const ts      = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const outJson = path.join(__dirname, `nerda-extract-results-${ts}.json`);
  const outTxt  = path.join(__dirname, `nerda-extract-summary-${ts}.txt`);
  writeFileSync(outJson, JSON.stringify(results, null, 2));

  const summary = [
    `NERDA Extract Summary — ${new Date().toISOString()}`,
    '─'.repeat(60),
    `UUIDs tested     : ${Object.keys(testUuids).length}`,
    `Succeeded        : ${succeeded}`,
    `Failed           : ${failed}`,
    `Timeseries errors: ${tsErrors}`,
    '',
    'RESULTS:',
    ...results.map(r => [
      `  ${r.name}`,
      `    UUID      : ${r.uuid}`,
      `    NERDA     : ${r.matched ? `✓ ${r.measurements.length} measurements` : `✗ ${r.error}`}`,
      `    Headroom  : ${r.headroomMatch ? `✓ NRN=${r.headroomMatch.id} GSP=${r.headroomMatch.gsp}` : '✗ no match'}`,
      r.sample ? `    Timeseries: ${r.sample.measurementType} latest=${r.sample.latestValue?.toFixed(2)} (${r.sample.readingCount} readings)` : '',
    ].filter(Boolean).join('\n')),
    '',
    'HOW TO ADD MORE SUBSTATIONS:',
    `  1. Log in to nerda.ssen.co.uk`,
    `  2. Navigate to a primary substation`,
    `  3. Copy the UUID from the browser URL`,
    `  4. Add to ${UUID_MAP_FILE}:`,
    `     { "Substation Name": "uuid-here", ... }`,
    `  5. Re-run this script`,
  ].join('\n');

  writeFileSync(outTxt, summary);
  console.log(`\n${'─'.repeat(60)}`);
  console.log(`Succeeded  : ${succeeded} / ${Object.keys(testUuids).length}`);
  console.log(`JSON  → ${outJson}`);
  console.log(`Text  → ${outTxt}\n`);
}

main().catch(e => {
  console.error('\n💥', e.message);
  process.exit(1);
});
