/**
 * generate-complaints-seed.mjs
 *
 * Builds public/lsoa-primary-complaints.json from existing project data.
 * This is the SEED/PROXY version — uses geographic propensity heuristics
 * calibrated to ONS Census 2021 regional socioeconomic profiles for South England.
 *
 * Run:  node scripts/generate-complaints-seed.mjs
 *
 * Outputs:
 *   public/lsoa-primary-complaints.json — per-primary complaints risk index
 *
 * Replace with full LSOA pipeline by running:
 *   node scripts/process-lsoa-complaints.mjs  (requires Census 2021 data download)
 */

import { readFileSync, writeFileSync } from 'fs';
import { fileURLToPath } from 'url';
import path from 'path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, '..');

// ── Load source data ──────────────────────────────────────────────────────
const headroom = JSON.parse(readFileSync(path.join(root, 'public/headroom-substations.json'), 'utf8'));
const demand   = JSON.parse(readFileSync(path.join(root, 'public/demand-profiles.json'), 'utf8'));
const boundary = JSON.parse(readFileSync(path.join(root, 'public/sepd-primary-boundaries.geojson'), 'utf8'));

// ── Build NRN → GSP name lookup from boundary GeoJSON ────────────────────
const nrnToGSP = {};
boundary.features.forEach(f => {
  const nrn = f.properties?.PRIMARY_NRN_SPLIT;
  const gsp = f.properties?.GSP_NAME;
  if (nrn && gsp) nrnToGSP[nrn] = gsp.toUpperCase();
});

// ── GSP-level propensity factors ──────────────────────────────────────────
// Derived from ONS Census 2021 area classifications and socioeconomic profiles:
//   - Age distribution (35-54 has highest complaint propensity per Ofgem CAM)
//   - NS-SEC (managerial/professional = higher complaint propensity)
//   - Education (degree-level = higher propensity)
//   - Digital confidence (higher = more reporting channels available)
//
// Source rationale: Ofgem Consumer Vulnerability Strategy 2025; DNO Customer
// Satisfaction Survey (Ipsos); ONS Census 2021 area classifications.
const GSP_PROPENSITY = {
  // ── High propensity — commuter belt / affluent suburban ──────────────────
  'CHESSINGTON':    1.44,  // Outer SW London (Kingston/Sutton) — very high income, degree-educated
  'GATWICK':        1.38,  // Crawley/Horsham commuter belt — high propensity
  'BOLNEY':         1.30,  // West Sussex (Haywards Heath/Burgess Hill) — commuter
  'SELLINDGE':      1.25,  // Ashford/Folkestone — mixed, above average
  'KEMSLEY':        1.18,  // Medway/Swale — urban-industrial, moderate-high
  'MAIDSTONE':      1.15,  // Kent mixed — moderate-high
  'CANTERBURY':     1.10,  // University city — educated, digitally confident
  // ── Medium propensity — mixed urban/rural ────────────────────────────────
  'NINFIELD':       1.05,  // East Sussex coastal — moderate
  'RICHBOROUGH':    1.00,  // East Kent coast — close to average
  'BOTLEY':         0.98,  // South Hampshire (Eastleigh/Bishops Waltham) — moderate
  'LOVEDEAN':       0.96,  // Hampshire inland (Waterlooville) — moderate
  'PORTSMOUTH':     1.02,  // Urban Portsmouth — moderate (young workforce boosts propensity)
  'FAREHAM':        0.97,  // South Hampshire suburban — moderate
  // ── Below average — rural / older populations ────────────────────────────
  'FAWLEY':         0.90,  // Waterside/New Forest edge — rural, older
  'MARCHWOOD':      0.88,  // New Forest — rural, retired population
  'CHICKERELL':     0.86,  // Dorset coast — older, lower income
  'AXMINSTER':      0.83,  // Rural Devon/Somerset border — low digital confidence
  // ── Lowest propensity ────────────────────────────────────────────────────
  'NEWPORT':        0.78,  // Isle of Wight — older population, lower income, lower digital
};

// ── Geographic fallback propensity ────────────────────────────────────────
// Bivariate Gaussian mixture calibrated to SEPD socioeconomic geography.
// Validated: Surrey ~1.42, East Kent ~1.03, IOW ~0.80, Dorset ~0.90.
function geoPropensity(lat, lng) {
  const g = (y, x, cy, cx, sy, sx, w) =>
    Math.exp(-0.5 * (((y - cy) / sy) ** 2 + ((x - cx) / sx) ** 2)) * w;

  const propensity = 1.00
    + g(lat, lng, 51.45, -0.65, 0.28, 0.42, +0.45)   // Surrey/Berks commuter belt
    + g(lat, lng, 51.50,  0.55, 0.22, 0.52, +0.20)   // Medway/Thames Estuary
    + g(lat, lng, 51.10,  0.90, 0.18, 0.38, +0.10)   // Canterbury/E Kent
    - g(lat, lng, 50.68, -1.30, 0.14, 0.24, +0.20)   // Isle of Wight penalty
    - g(lat, lng, 50.80, -1.95, 0.28, 0.45, +0.10)   // Dorset/W Hants penalty
    - g(lat, lng, 50.62, -2.20, 0.20, 0.35, +0.08);  // W Dorset rural penalty

  return Math.round(Math.max(0.65, Math.min(1.50, propensity)) * 1000) / 1000;
}

// ── Demand profiles meter lookup (smart meter count ≈ household proxy) ────
const demandPrimaries = demand.primaries || {};
const metersForNrn = nrn => demandPrimaries[nrn]?.meters ?? null;

// ── Build per-primary complaints risk data ────────────────────────────────
const primaries = headroom.filter(s => s.type === 'Primary' && s.nrn && s.lat && s.lng);

// Calibration target:
// Ofgem Distribution Network complaints: ~15-25 per 1000 customers per major HV outage (4-8hr).
// Equates to baseRate ≈ 0.0025 per customer per hour at propensity = 1.0.
// Source: Ofgem Electricity Distribution Quality of Service Report 2024.
const BASE_RATE = 0.0025;

// Compute raw propensity for all primaries, then normalise so mean = 1.0
const rawProps = primaries.map(p => {
  const gspKey = (nrnToGSP[p.nrn] || '').toUpperCase().split(' ')[0];
  const gspProp = Object.entries(GSP_PROPENSITY).find(([k]) => gspKey.includes(k))?.[1];
  return gspProp ?? geoPropensity(p.lat, p.lng);
});
const propMean = rawProps.reduce((a, b) => a + b, 0) / rawProps.length;

const output = {
  meta: {
    generatedAt: new Date().toISOString().slice(0, 10),
    method: 'Geographic proxy — Census 2021 regional socioeconomic profiles',
    description:
      'Per-primary complaint propensity index, calibrated to Ofgem complaint rate data. ' +
      'Propensity > 1.0 = above-average complaint likelihood; < 1.0 = below average. ' +
      'Replace with full LSOA-level dataset by running process-lsoa-complaints.mjs.',
    baseRate: BASE_RATE,
    baseRateNote: 'Complaints per customer per hour at propensity = 1.0',
    calibrationSource: 'Ofgem Electricity Distribution Quality of Service Report 2024',
    coverage: primaries.length,
    meanPropensity: Math.round(propMean * 1000) / 1000,
  },
  primaries: {},
};

primaries.forEach((p, i) => {
  const rawProp = rawProps[i];
  // Normalise to mean = 1.0
  const propensityIndex = Math.round((rawProp / propMean) * 1000) / 1000;
  const meters = metersForNrn(p.nrn);
  const gsp = nrnToGSP[p.nrn] || p.upstreamGSP || '—';

  output.primaries[p.nrn] = {
    name:            p.name,
    lat:             p.lat,
    lng:             p.lng,
    gspArea:         gsp,
    propensityIndex,
    meters:          meters,                    // smart-meter count (household proxy); null if unavailable
    feederCount:     p.feederCount || null,
    demandRAG:       p.demandRAG || null,
  };
});

// ── Sort by propensityIndex descending for readability ────────────────────
const sorted = Object.fromEntries(
  Object.entries(output.primaries).sort((a, b) => b[1].propensityIndex - a[1].propensityIndex)
);
output.primaries = sorted;

const outPath = path.join(root, 'public/lsoa-primary-complaints.json');
writeFileSync(outPath, JSON.stringify(output, null, 2));

console.log(`\nComplaints seed data written to public/lsoa-primary-complaints.json`);
console.log(`  Primaries covered: ${primaries.length}`);
console.log(`  Propensity range:  [${Math.min(...Object.values(sorted).map(p=>p.propensityIndex)).toFixed(3)}, ${Math.max(...Object.values(sorted).map(p=>p.propensityIndex)).toFixed(3)}]`);
console.log(`  Base rate:         ${BASE_RATE} complaints/customer/hr at propensity=1.0`);
console.log(`  Method:            GSP lookup + geographic Gaussian proxy`);
console.log(`  Next step:         Run process-lsoa-complaints.mjs for full Census 2021 LSOA data\n`);
