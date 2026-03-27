/**
 * process-smartmeter.mjs
 *
 * Aggregates the DCC smart-meter half-hourly CSV into demand profiles
 * suitable for the substation tool.
 *
 * Outputs:
 *   public/demand-by-primary.json
 *       { "<primaryNRN>": { "HH48": [ kW, ... ] } }   ← 48 half-hours, index 0 = 00:30
 *
 *   public/demand-transformers/<primaryNRN>.json
 *       { "<txNRN>": [ kW, ... ] }                    ← 48 values per transformer
 *
 * dataset_id layout (12 chars, zero-padded):
 *   [0-1]  LV feeder
 *   [2-4]  transformer NRN (3 digits)
 *   [5-7]  HV feeder NRN  (3 digits)
 *   [8-11] primary NRN    (4 digits)
 *
 * Unit: total_consumption_active_import is in Wh per 30-min period.
 *   → average kW = Wh × 2 / 1000
 */

import fs   from 'fs';
import path from 'path';
import readline from 'readline';

const CSV   = path.resolve('manual_data/2026-03-24.csv');
const OUT_P = path.resolve('public/demand-by-primary.json');
const OUT_T = path.resolve('public/demand-transformers');

if (!fs.existsSync(OUT_T)) fs.mkdirSync(OUT_T, { recursive: true });

// primaryNRN → txNRN → halfHourIndex → accumulated Wh
const data = new Map();      // Map<primaryNRN, Map<txNRN, Float64Array(48)>>

// We build an index of timestamp → halfHourIndex on first encounter.
// Timestamps come as "2026-03-24THH:MM:00.000Z" for HH:MM in :30 or :00 increments.
const tsIndex = new Map();   // "HH:MM" → 0..47

function tsToIndex(isoStr) {
  const t = isoStr.slice(11, 16); // "HH:MM"
  if (tsIndex.has(t)) return tsIndex.get(t);
  const idx = tsIndex.size;
  if (idx >= 48) return -1;       // safety guard
  tsIndex.set(t, idx);
  return idx;
}

let rows = 0;
let skipped = 0;

const rl = readline.createInterface({ input: fs.createReadStream(CSV), crlfDelay: Infinity });

let header = true;
rl.on('line', line => {
  if (header) { header = false; return; }

  // Fast manual split to avoid CSV library dependency
  // Fields don't contain commas (location field uses "" when empty, geo is "" too)
  const fields = line.split(',');
  if (fields.length < 15) { skipped++; return; }

  const id  = fields[0];
  if (id.length !== 12) { skipped++; return; }

  const primaryNRN = id.slice(8, 12);   // e.g. "2001"
  const txNRN      = id.slice(2, 5);    // e.g. "003"
  const tsRaw      = fields[14];        // "2026-03-24T00:30:00.000Z"
  const valStr     = fields[11];        // total_consumption_active_import (Wh)

  if (!tsRaw || !valStr || valStr === '""' || valStr === '') { skipped++; return; }

  const hhIdx = tsToIndex(tsRaw);
  if (hhIdx < 0) { skipped++; return; }

  const wh = parseFloat(valStr);
  if (isNaN(wh)) { skipped++; return; }

  // Accumulate
  if (!data.has(primaryNRN)) data.set(primaryNRN, new Map());
  const txMap = data.get(primaryNRN);
  if (!txMap.has(txNRN)) txMap.set(txNRN, new Float64Array(48));
  txMap.get(txNRN)[hhIdx] += wh;

  rows++;
  if (rows % 500_000 === 0) process.stderr.write(`  processed ${(rows/1e6).toFixed(1)}M rows…\n`);
});

rl.on('close', () => {
  process.stderr.write(`\nDone reading: ${rows.toLocaleString()} rows, ${skipped} skipped\n`);
  process.stderr.write(`Timestamps mapped (${tsIndex.size}): ${[...tsIndex.keys()].slice(0,6).join(', ')} …\n`);
  process.stderr.write(`Primaries: ${data.size}\n\n`);

  // Sort timestamps into order (00:30, 01:00, ..., 00:00)
  const sortedTs = [...tsIndex.entries()]
    .sort((a, b) => a[1] - b[1])
    .map(([ts]) => ts);

  // Build primary-level JSON (sum across all tx per half-hour → kW)
  const byPrimary = {};
  for (const [pNRN, txMap] of data) {
    const primary = new Float64Array(48);
    for (const arr of txMap.values()) {
      for (let i = 0; i < 48; i++) primary[i] += arr[i];
    }
    // Convert Wh → kW (Wh × 2 / 1000)
    byPrimary[pNRN] = {
      timestamps: sortedTs,
      kW: Array.from(primary).map(wh => Math.round(wh * 2 / 1000 * 10) / 10),
    };
  }

  fs.writeFileSync(OUT_P, JSON.stringify(byPrimary));
  process.stderr.write(`Written: ${OUT_P}  (${(fs.statSync(OUT_P).size/1024).toFixed(0)} KB)\n`);

  // Build per-primary transformer JSON
  let txFiles = 0;
  for (const [pNRN, txMap] of data) {
    const out = {};
    for (const [txNRN, arr] of txMap) {
      out[txNRN] = Array.from(arr).map(wh => Math.round(wh * 2 / 1000 * 10) / 10);
    }
    const fp = path.join(OUT_T, `${pNRN}.json`);
    fs.writeFileSync(fp, JSON.stringify({ timestamps: sortedTs, transformers: out }));
    txFiles++;
  }
  process.stderr.write(`Written: ${txFiles} transformer files in ${OUT_T}\n`);
});
