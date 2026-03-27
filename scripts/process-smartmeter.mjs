/**
 * process-smartmeter.mjs  (v3)
 *
 * Aggregates DCC smart-meter half-hourly CSV into SEPD-only demand profiles.
 * Uses proper RFC-4180 CSV parsing to handle quoted fields with embedded commas.
 * Rejects outlier rows (value > MAX_WH_PER_FEEDER) to exclude corrupt data.
 *
 * Output:  public/demand-profiles.json
 * {
 *   date:       "2026-03-24",
 *   timestamps: ["00:30","01:00",...,"00:00"],   // 48 HH:MM labels
 *   primaries: {
 *     "<primaryNRN>": {
 *       kW:   [<48 floats, 1dp>],                // primary-level average kW
 *       meters: <int>,                            // avg active smart meter count
 *       transformers: {
 *         "<secSubId>": { name: string, kW: [48] }
 *       }
 *     }
 *   }
 * }
 *
 * dataset_id layout (12 chars):
 *   [0-1]  LV feeder number
 *   [2-4]  transformer NAFIRS NRN
 *   [5-7]  HV feeder NRN
 *   [8-11] primary NRN (4-digit, matches headroom-substations.json nrn field)
 *
 * Transformer grouping: secondary_substation_id (field 3) + name (field 4).
 * Unit: total_consumption_active_import = Wh per 30-min period.
 *   kW = Wh × 2 / 1000
 */

import fs       from 'fs';
import path     from 'path';
import readline from 'readline';

const CSV         = path.resolve('manual_data/2026-03-24.csv');
const OUT         = path.resolve('public/demand-profiles.json');
const DATE        = '2026-03-24';
const MAX_WH      = 1_000_000;   // 1 MWh per 30min per feeder ≈ 2 MW — reject above this

// ── SEPD NRN whitelist ────────────────────────────────────────────────────
const headroom  = JSON.parse(fs.readFileSync(path.resolve('public/headroom-substations.json'), 'utf8'));
const SEPD_NRNS = new Set(
  headroom
    .filter(s => s.type === 'Primary' && s.nrn && !s.nrn.includes('-'))
    .map(s => s.nrn.padStart(4, '0'))
);
console.error(`[SEPD whitelist] ${SEPD_NRNS.size} primary NRNs`);

// ── RFC-4180 CSV field splitter ───────────────────────────────────────────
// Handles quoted fields with embedded commas and escaped double-quotes.
function splitCSV(line) {
  const fields = [];
  let i = 0, cur = '';
  while (i < line.length) {
    if (line[i] === '"') {
      i++;
      while (i < line.length) {
        if (line[i] === '"' && line[i + 1] === '"') { cur += '"'; i += 2; }
        else if (line[i] === '"') { i++; break; }
        else { cur += line[i++]; }
      }
    } else if (line[i] === ',') {
      fields.push(cur); cur = ''; i++;
    } else {
      cur += line[i++];
    }
  }
  fields.push(cur);
  return fields;
}

// ── Accumulator ───────────────────────────────────────────────────────────
const acc = new Map(); // primaryNRN → { kWh[48], meters[48], tx: Map }

function getPrimary(pNRN) {
  if (!acc.has(pNRN)) acc.set(pNRN, { kWh: new Float64Array(48), meters: new Float32Array(48), tx: new Map() });
  return acc.get(pNRN);
}
function getTx(p, secId, secName) {
  if (!p.tx.has(secId)) p.tx.set(secId, { name: (secName || secId), kWh: new Float64Array(48) });
  else if (secName && secName !== 'null' && p.tx.get(secId).name === secId) p.tx.get(secId).name = secName;
  return p.tx.get(secId);
}

// ── Timestamp ordering ────────────────────────────────────────────────────
const tsIndex = new Map();
const tsOrder = [];
function tsToIdx(iso) {
  const t = (iso || '').slice(11, 16);
  if (!t) return -1;
  if (tsIndex.has(t)) return tsIndex.get(t);
  const idx = tsIndex.size;
  if (idx >= 48) return -1;
  tsIndex.set(t, idx); tsOrder.push(t);
  return idx;
}

// ── Stream CSV ─────────────────────────────────────────────────────────────
let rows = 0, skipped = 0, shepd = 0, corrupt = 0;

const rl = readline.createInterface({ input: fs.createReadStream(CSV), crlfDelay: Infinity });
let isHeader = true;

rl.on('line', line => {
  if (isHeader) { isHeader = false; return; }

  const f = splitCSV(line);
  if (f.length < 15) { skipped++; return; }

  const id      = f[0];
  if (!id || id.length !== 12) { skipped++; return; }

  const primaryNRN = id.slice(8, 12);
  if (!SEPD_NRNS.has(primaryNRN)) { shepd++; return; }

  const secId   = f[3];              // secondary_substation_id
  const secName = (f[4] || '').trim();
  const devCnt  = parseFloat(f[8]);  // aggregated_device_count_active
  const valStr  = f[11];             // total_consumption_active_import (Wh)
  const tsRaw   = f[14];             // data_collection_log_timestamp

  if (!valStr || valStr === '') { skipped++; return; }
  const wh = parseFloat(valStr);
  if (isNaN(wh) || wh < 0)   { skipped++; return; }
  if (wh > MAX_WH)            { corrupt++; return; }   // reject outliers

  const hhIdx = tsToIdx(tsRaw);
  if (hhIdx < 0) { skipped++; return; }

  const p  = getPrimary(primaryNRN);
  p.kWh[hhIdx]    += wh;
  p.meters[hhIdx] += isNaN(devCnt) ? 0 : devCnt;

  const tx = getTx(p, secId, secName);
  tx.kWh[hhIdx] += wh;

  rows++;
  if (rows % 200_000 === 0) process.stderr.write(`  ${(rows/1e6).toFixed(2)}M SEPD rows…\n`);
});

rl.on('close', () => {
  process.stderr.write(`\nDone: ${rows.toLocaleString()} SEPD rows | ${shepd.toLocaleString()} SHEPD skipped | ${corrupt} corrupt outliers | ${skipped} invalid\n`);
  process.stderr.write(`Timestamps (${tsOrder.length}): ${tsOrder.slice(0,6).join(', ')} …\n`);
  process.stderr.write(`SEPD primaries with data: ${acc.size}\n\n`);

  // kW conversion: Wh × 2 / 1000, rounded to 1 dp
  const toKW = wh => Math.round(wh * 2 / 100) / 10;

  const primaries = {};
  for (const [pNRN, p] of acc) {
    const txOut = {};
    for (const [secId, t] of p.tx) {
      txOut[secId] = { name: t.name, kW: Array.from(t.kWh).map(toKW) };
    }
    const peakKW = Math.max(...Array.from(p.kWh).map(toKW));
    const avgMeters = Math.round(Array.from(p.meters).reduce((a,b)=>a+b,0) / p.meters.length);
    primaries[pNRN] = { kW: Array.from(p.kWh).map(toKW), meters: avgMeters, transformers: txOut };

    process.stderr.write(`  ${pNRN}: peak ${peakKW.toFixed(0)} kW, ${Object.keys(txOut).length} tx, ~${avgMeters} meters\n`);
  }

  const output = { date: DATE, timestamps: tsOrder, primaries };
  const json   = JSON.stringify(output);
  fs.writeFileSync(OUT, json);
  process.stderr.write(`\nWritten: ${OUT}  (${(json.length/1024).toFixed(0)} KB)\n`);
});
