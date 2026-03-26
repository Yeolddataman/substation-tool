/**
 * process-dfes.cjs
 * Aggregates DFES 2025 ESA projections by primary substation.
 * Outputs public/dfes-by-primary.json and public/dfes-licence.json
 */
const XLSX = require('../node_modules/xlsx');
const fs   = require('fs');
const path = require('path');

const FILE   = path.resolve(__dirname, '../manual_data/ssen-dfes-2025-results-by-licence-area-and-esav2.xlsx');
const OUT1   = path.resolve(__dirname, '../public/dfes-by-primary.json');
const OUT2   = path.resolve(__dirname, '../public/dfes-licence.json');

console.log('Reading workbook (this may take a moment)...');
const wb = XLSX.readFile(FILE, { cellDates: false });

// ── Config ─────────────────────────────────────────────────────────────────
const SCENARIOS = {
  'Electric Engagement': 'EE',
  'Holistic Transition':  'HT',
  'Falling Behind':       'FB',
};

// Key technologies → short key, category filter
const TECH_MAP = {
  'Electric vehicles':         { key: 'ev',      cat: 'Demand' },
  'EV chargers':               { key: 'evc',     cat: 'Demand' },
  'Domestic heat pumps':       { key: 'dhp',     cat: 'Demand' },
  'Non-domestic heat pumps':   { key: 'ndhp',    cat: 'Demand' },
  'Solar PV':                  { key: 'solar',   cat: 'Generation' },
  'Battery storage':           { key: 'battery', cat: 'Storage' },
};

// Years to keep (sparse — reduces output size)
const KEEP_YEARS = ['Baseline', 2026, 2030, 2035, 2040, 2045, 2050];

// ── Parse ESA sheet ─────────────────────────────────────────────────────────
console.log('Parsing ESA projections...');
const ws  = wb.Sheets['05_ESA_projections'];
const raw = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });
const headers = raw[0];

const col    = (name) => headers.indexOf(name);
const yearIdx = KEEP_YEARS.map(y => ({ year: String(y), idx: headers.indexOf(y === 'Baseline' ? 'Baseline' : y) }))
                           .filter(y => y.idx !== -1);

const byPrimary = {};

for (let i = 1; i < raw.length; i++) {
  const r       = raw[i];
  const tech    = r[col('Technology')];
  const scenario= r[col('Scenario')];
  const category= r[col('Category')];
  const units   = r[col('Units')];
  const primary = r[col('Primary_name')];
  const licence = r[col('Licence_area')];

  if (!tech || !scenario || !primary || licence !== 'SEPD') continue;
  const scenKey = SCENARIOS[scenario];
  if (!scenKey) continue;
  const techCfg = TECH_MAP[tech];
  if (!techCfg) continue;
  if (techCfg.cat && category !== techCfg.cat) continue;

  const pName = primary.trim().toUpperCase();
  if (!byPrimary[pName]) byPrimary[pName] = {};
  const p = byPrimary[pName];
  if (!p[techCfg.key]) p[techCfg.key] = {};
  if (!p[techCfg.key][scenKey]) p[techCfg.key][scenKey] = {};

  // Accumulate (some primaries have multiple rows per tech/scenario — e.g. subtechnologies)
  yearIdx.forEach(({ year, idx }) => {
    const val = parseFloat(r[idx]) || 0;
    p[techCfg.key][scenKey][year] = (p[techCfg.key][scenKey][year] || 0) + val;
  });

  // Store units for reference
  if (!p[techCfg.key].units) p[techCfg.key].units = units;
}

// Round all values to 1dp
Object.values(byPrimary).forEach(p =>
  Object.entries(p).forEach(([techKey, techData]) => {
    Object.entries(techData).forEach(([scenKey, yearVals]) => {
      if (typeof yearVals === 'object' && !Array.isArray(yearVals)) {
        Object.keys(yearVals).forEach(y => {
          yearVals[y] = Math.round(yearVals[y] * 10) / 10;
        });
      }
    });
  })
);

console.log('Primaries processed:', Object.keys(byPrimary).length);

// ── Parse Licence area sheet ────────────────────────────────────────────────
console.log('Parsing licence area projections...');
const ws2  = wb.Sheets['04_Licence_area_projections'];
const raw2 = XLSX.utils.sheet_to_json(ws2, { header: 1, defval: '' });
const h2   = raw2[0];
const yearIdx2 = KEEP_YEARS.map(y => ({ year: String(y), idx: h2.indexOf(y === 'Baseline' ? 'Baseline' : y) }))
                             .filter(y => y.idx !== -1);

const licenceData = {};

for (let i = 1; i < raw2.length; i++) {
  const r       = raw2[i];
  const tech    = r[0];
  const scenario= r[2];
  const units   = r[4];
  const licence = r[5];

  if (licence !== 'SEPD') continue;
  const scenKey = SCENARIOS[scenario];
  if (!scenKey) continue;
  const techCfg = TECH_MAP[tech];
  if (!techCfg) continue;

  if (!licenceData[techCfg.key]) licenceData[techCfg.key] = { units };
  if (!licenceData[techCfg.key][scenKey]) licenceData[techCfg.key][scenKey] = {};

  yearIdx2.forEach(({ year, idx }) => {
    const val = parseFloat(r[idx]) || 0;
    licenceData[techCfg.key][scenKey][year] = Math.round(((licenceData[techCfg.key][scenKey][year] || 0) + val) * 10) / 10;
  });
}

// ── Write outputs ───────────────────────────────────────────────────────────
fs.writeFileSync(OUT1, JSON.stringify(byPrimary));
fs.writeFileSync(OUT2, JSON.stringify(licenceData));

const s1 = (fs.statSync(OUT1).size / 1024).toFixed(0);
const s2 = (fs.statSync(OUT2).size / 1024).toFixed(0);
console.log(`✅ dfes-by-primary.json  — ${s1} KB (${Object.keys(byPrimary).length} primaries)`);
console.log(`✅ dfes-licence.json     — ${s2} KB (SEPD licence totals)`);
console.log('\nSample primary (ALDERSHOT EV EE):',
  JSON.stringify(byPrimary['ALDERSHOT']?.ev?.EE || 'not found'));
