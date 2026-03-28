// Model Validation Script — runs standalone with Node.js
// Usage: node scripts/validate-model.mjs
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import path from 'path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const data = JSON.parse(readFileSync(path.join(__dirname, '../public/headroom-substations.json'), 'utf8'));

const ALL_PRIMARIES = data.filter(
  s => s.type === 'Primary' && s.nrn && s.faultsByYear &&
       Object.keys(s.faultsByYear).length >= 3
);
const ALL_YEARS = [...new Set(ALL_PRIMARIES.flatMap(s => Object.keys(s.faultsByYear)))].sort();

// ── helpers ──────────────────────────────────────────────────────────────────
const mean   = arr => arr.reduce((a, b) => a + b, 0) / arr.length;
const std    = arr => { const m = mean(arr); return Math.sqrt(arr.reduce((a,b) => a+(b-m)**2, 0) / arr.length); };
const sigmoid = z => 1 / (1 + Math.exp(-z));

function spearman(x, y) {
  const n = x.length;
  if (n < 3) return null;
  const rank = arr => {
    const idx = [...arr].map((v, i) => [v, i]).sort((a, b) => a[0] - b[0]);
    const r = new Array(n);
    idx.forEach(([, i], ri) => (r[i] = ri + 1));
    return r;
  };
  const rx = rank(x), ry = rank(y);
  const d2 = rx.reduce((s, r, i) => s + (r - ry[i]) ** 2, 0);
  return 1 - (6 * d2) / (n * (n * n - 1));
}

const avgRate = (s, years) => {
  const vals = years.map(y => s.faultsByYear[y]).filter(v => v != null).map(Number);
  return vals.length ? mean(vals) / Math.max(1, s.feederCount || 1) : null;
};

function trainModel(primaries, trainYears) {
  const pts = primaries.map(s => ({ s, rate: avgRate(s, trainYears) })).filter(p => p.rate != null && p.rate >= 0);
  const rates = pts.map(p => p.rate);
  const mu = mean(rates), sg = std(rates) || 1;
  const map = {};
  pts.forEach(({ s, rate }) => { map[s.nrn] = { vuln: 0.60 + sigmoid((rate - mu) / sg) * 0.90 }; });
  return { map, mu, sg, n: pts.length };
}

const hr = () => console.log('━'.repeat(62));

// ═════════════════════════════════════════════════════════════════════════════
// 1. YEAR-ON-YEAR AUTOCORRELATION
// ═════════════════════════════════════════════════════════════════════════════
hr(); console.log('1. YEAR-ON-YEAR AUTOCORRELATION  (persistence of fault rates)'); hr();
const yrRhos = [];
for (let i = 0; i < ALL_YEARS.length - 1; i++) {
  const yA = ALL_YEARS[i], yB = ALL_YEARS[i + 1];
  const pairs = ALL_PRIMARIES.map(s => {
    const a = s.faultsByYear[yA] != null ? Number(s.faultsByYear[yA]) / Math.max(1, s.feederCount || 1) : null;
    const b = s.faultsByYear[yB] != null ? Number(s.faultsByYear[yB]) / Math.max(1, s.feederCount || 1) : null;
    return a != null && b != null ? { a, b } : null;
  }).filter(Boolean);
  const rho = spearman(pairs.map(p => p.a), pairs.map(p => p.b));
  yrRhos.push(rho);
  console.log(`  ${yA}→${yB}  rho = ${rho?.toFixed(3).padStart(6)}   (n=${pairs.length})`);
}
console.log(`\n  Mean year-on-year rho: ${mean(yrRhos).toFixed(3)}  (signal stability driving model)`);

// ═════════════════════════════════════════════════════════════════════════════
// 2. LEAVE-ONE-YEAR-OUT CROSS-VALIDATION
// ═════════════════════════════════════════════════════════════════════════════
hr(); console.log('2. LEAVE-ONE-YEAR-OUT CROSS-VALIDATION'); hr();
const loyo = [];
for (const holdYear of ALL_YEARS) {
  const trainYrs = ALL_YEARS.filter(y => y !== holdYear);
  const { map } = trainModel(ALL_PRIMARIES, trainYrs);
  const pairs = ALL_PRIMARIES.map(s => {
    const testRate = s.faultsByYear[holdYear] != null ? Number(s.faultsByYear[holdYear]) / Math.max(1, s.feederCount || 1) : null;
    const vuln = map[s.nrn]?.vuln;
    return testRate != null && vuln != null ? { vuln, testRate } : null;
  }).filter(Boolean);
  const rho = spearman(pairs.map(p => p.vuln), pairs.map(p => p.testRate));
  loyo.push(rho);
  console.log(`  Hold-out ${holdYear}  rho = ${rho?.toFixed(3).padStart(6)}   (n=${pairs.length})`);
}
console.log(`\n  Mean LOYO rho: ${mean(loyo).toFixed(3)}   Std: ${std(loyo).toFixed(3)}`);
console.log(`  Min: ${Math.min(...loyo).toFixed(3)}   Max: ${Math.max(...loyo).toFixed(3)}`);

// ═════════════════════════════════════════════════════════════════════════════
// 3. BASELINE COMPARISONS (train 2015-2023, test 2024-2025)
// ═════════════════════════════════════════════════════════════════════════════
hr(); console.log('3. BASELINE COMPARISONS  (train=2015-2023, test=2024-2025)'); hr();
const TRAIN = ALL_YEARS.slice(0, -2);
const TEST  = ALL_YEARS.slice(-2);
const { map: modelMap } = trainModel(ALL_PRIMARIES, TRAIN);

const evalPairs = ALL_PRIMARIES.map(s => {
  const testRate  = avgRate(s, TEST);
  const trainRate = avgRate(s, TRAIN);
  const vuln      = modelMap[s.nrn]?.vuln;
  return testRate != null && vuln != null && trainRate != null ? { nrn: s.nrn, vuln, testRate, trainRate } : null;
}).filter(Boolean);

const modelRho    = spearman(evalPairs.map(p => p.vuln),      evalPairs.map(p => p.testRate));
const trainRho    = spearman(evalPairs.map(p => p.trainRate), evalPairs.map(p => p.testRate));
// Lagged-mean baseline: predict each site as the overall mean (equivalent to ρ=0 by definition)
// More interesting: "lazy" baseline = just use each site's global mean rate (all years)
const globalRates = ALL_PRIMARIES.map(s => ({ nrn: s.nrn, rate: avgRate(s, ALL_YEARS) })).filter(p => p.rate != null);
const globalMap   = Object.fromEntries(globalRates.map(p => [p.nrn, p.rate]));
const globalRho   = spearman(evalPairs.map(p => globalMap[p.nrn] ?? 0), evalPairs.map(p => p.testRate));

console.log(`  Model (Z-score sigmoid, train years):  rho = ${modelRho?.toFixed(4)}`);
console.log(`  Raw train rate (no sigmoid scaling):   rho = ${trainRho?.toFixed(4)}  <- is sigmoid adding value?`);
console.log(`  Global mean rate (all 11 years):       rho = ${globalRho?.toFixed(4)}  <- leaky upper bound`);
console.log(`  Naive constant (everyone same vuln):   rho = 0.0000`);
console.log(`  n = ${evalPairs.length} primaries`);

// ═════════════════════════════════════════════════════════════════════════════
// 4. PERMUTATION TEST (statistical significance)
// ═════════════════════════════════════════════════════════════════════════════
hr(); console.log('4. PERMUTATION TEST  (5 000 shuffles)'); hr();
const testRates = evalPairs.map(p => p.testRate);
const vulns     = evalPairs.map(p => p.vuln);
let beats = 0;
const N_PERM = 5000;
const permRhos = [];
for (let i = 0; i < N_PERM; i++) {
  const shuffled = [...vulns].sort(() => Math.random() - 0.5);
  const r = spearman(shuffled, testRates);
  permRhos.push(r);
  if (r >= modelRho) beats++;
}
permRhos.sort((a, b) => a - b);
const pValue = beats / N_PERM;
const ci95lo = permRhos[Math.floor(N_PERM * 0.025)];
const ci95hi = permRhos[Math.floor(N_PERM * 0.975)];
console.log(`  Observed rho:    ${modelRho?.toFixed(4)}`);
console.log(`  Null mean rho:   ${mean(permRhos).toFixed(4)}`);
console.log(`  Null 95% CI:     [${ci95lo.toFixed(4)}, ${ci95hi.toFixed(4)}]`);
console.log(`  p-value:         ${pValue < 0.001 ? '< 0.001' : pValue.toFixed(4)}`);
console.log(`  Significant:     ${pValue < 0.05 ? 'YES (p < 0.05)' : 'NO (p >= 0.05)'}`);

// ═════════════════════════════════════════════════════════════════════════════
// 5. VULNERABILITY DISTRIBUTION
// ═════════════════════════════════════════════════════════════════════════════
hr(); console.log('5. VULNERABILITY DISTRIBUTION  (is the model differentiating?)'); hr();
const allVulns = evalPairs.map(p => p.vuln).sort((a, b) => a - b);
const pct = q => allVulns[Math.floor(q * (allVulns.length - 1))];
console.log(`  Range:    [${Math.min(...allVulns).toFixed(3)}, ${Math.max(...allVulns).toFixed(3)}]`);
console.log(`  P10: ${pct(0.10).toFixed(3)}  P25: ${pct(0.25).toFixed(3)}  Median: ${pct(0.50).toFixed(3)}  P75: ${pct(0.75).toFixed(3)}  P90: ${pct(0.90).toFixed(3)}`);
console.log(`  Std dev: ${std(allVulns).toFixed(4)}   (wider = more differentiation between sites)`);
const low  = allVulns.filter(v => v < 0.85).length;
const high = allVulns.filter(v => v > 1.15).length;
const mid  = allVulns.length - low - high;
console.log(`  Low (<0.85): ${low} sites (${(low/allVulns.length*100).toFixed(1)}%)`);
console.log(`  Mid  (0.85-1.15): ${mid} sites (${(mid/allVulns.length*100).toFixed(1)}%)`);
console.log(`  High (>1.15): ${high} sites (${(high/allVulns.length*100).toFixed(1)}%)`);

// ═════════════════════════════════════════════════════════════════════════════
// 6. OVERFITTING CHECK
// ═════════════════════════════════════════════════════════════════════════════
hr(); console.log('6. OVERFITTING CHECK  (train rho vs test rho)'); hr();
const trainSelfRho = spearman(evalPairs.map(p => p.vuln), evalPairs.map(p => p.trainRate));
const drop = (trainSelfRho - modelRho) / Math.abs(trainSelfRho) * 100;
console.log(`  Train rho (model vs training data):  ${trainSelfRho?.toFixed(4)}`);
console.log(`  Test  rho (model vs held-out data):  ${modelRho?.toFixed(4)}`);
console.log(`  Generalisation drop: ${drop.toFixed(1)}%`);
console.log(`  Verdict: ${drop < 5 ? 'GOOD — minimal overfitting' : drop < 15 ? 'ACCEPTABLE — moderate generalisation gap' : 'CONCERN — large train/test gap'}`);

// ═════════════════════════════════════════════════════════════════════════════
// SUMMARY
// ═════════════════════════════════════════════════════════════════════════════
hr(); console.log('SUMMARY'); hr();
console.log(`  Signal strength (mean yr-on-yr rho):  ${mean(yrRhos).toFixed(3)}`);
console.log(`  LOYO cross-validation mean rho:       ${mean(loyo).toFixed(3)} +/- ${std(loyo).toFixed(3)}`);
console.log(`  Test rho (held-out 2024-2025):        ${modelRho?.toFixed(3)}`);
console.log(`  Statistically significant:            ${pValue < 0.05 ? 'YES  p' + (pValue < 0.001 ? '<0.001' : '=' + pValue.toFixed(3)) : 'NO'}`);
console.log(`  Better than naive (constant) model:   ${modelRho > 0 ? 'YES' : 'NO'}`);
console.log(`  Sigmoid adds value over raw rank:     ${Math.abs(modelRho - trainRho) < 0.001 ? 'NO (monotone transform, same rank)' : modelRho > trainRho ? 'YES' : 'NO'}`);
console.log('');
