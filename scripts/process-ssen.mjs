/**
 * process-ssen.mjs
 * Reads SSEN substation CSV, filters to SEPD South England LV substations,
 * converts BNG (OSGB36) easting/northing to WGS84 lat/lng, outputs compact JSON.
 *
 * Run: node scripts/process-ssen.mjs
 * Output: public/ssen-lv-substations.json
 */

import { createReadStream, writeFileSync, mkdirSync } from 'fs';
import { createInterface } from 'readline';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const INPUT  = resolve(__dirname, '../manual_data/20260323_substation_locations_csv.csv');
const OUTPUT = resolve(__dirname, '../public/ssen-lv-substations.json');

// Scottish SEPD areas — exclude (SHEPD territory mislabelled or SEPD legacy)
const EXCLUDE_AREAS = new Set([
  'Argyll & West Highl.', 'Highland District', 'North East District',
  'Tayside and Central', 'Western Isles',
]);

// ── BNG (OSGB36) → WGS84 ──────────────────────────────────────────────────
// OS "A Guide to coordinate systems in Great Britain" algorithm
function bngToWgs84(E, N) {
  // Step 1: OSGB36 easting/northing → OSGB36 lat/lon (Airy 1830)
  const a = 6377563.396, b = 6356256.909;
  const F0 = 0.9996012717;
  const lat0 = 49 * Math.PI / 180;
  const lon0 = -2 * Math.PI / 180;
  const N0 = -100000, E0 = 400000;
  const e2 = 1 - (b * b) / (a * a);
  const n = (a - b) / (a + b), n2 = n * n, n3 = n * n * n;

  let lat = lat0, M = 0;
  do {
    lat = (N - N0 - M) / (a * F0) + lat;
    const Ma = (1 + n + 1.25 * n2 + 1.25 * n3) * (lat - lat0);
    const Mb = (3 * n + 3 * n2 + 2.625 * n3) * Math.sin(lat - lat0) * Math.cos(lat + lat0);
    const Mc = (1.875 * n2 + 1.875 * n3) * Math.sin(2 * (lat - lat0)) * Math.cos(2 * (lat + lat0));
    const Md = (35 / 24) * n3 * Math.sin(3 * (lat - lat0)) * Math.cos(3 * (lat + lat0));
    M = b * F0 * (Ma - Mb + Mc - Md);
  } while (Math.abs(N - N0 - M) >= 0.00001);

  const sinLat = Math.sin(lat), cosLat = Math.cos(lat), tanLat = Math.tan(lat);
  const nu  = a * F0 / Math.sqrt(1 - e2 * sinLat * sinLat);
  const rho = a * F0 * (1 - e2) / Math.pow(1 - e2 * sinLat * sinLat, 1.5);
  const eta2 = nu / rho - 1;

  const dE = E - E0;
  const VII  = tanLat / (2 * rho * nu);
  const VIII = tanLat / (24 * rho * nu ** 3) * (5 + 3 * tanLat ** 2 + eta2 - 9 * tanLat ** 2 * eta2);
  const IX   = tanLat / (720 * rho * nu ** 5) * (61 + 90 * tanLat ** 2 + 45 * tanLat ** 4);
  const X    = 1 / (cosLat * nu);
  const XI   = 1 / (cosLat * 6 * nu ** 3) * (nu / rho + 2 * tanLat ** 2);
  const XII  = 1 / (cosLat * 120 * nu ** 5) * (5 + 28 * tanLat ** 2 + 24 * tanLat ** 4);
  const XIIA = 1 / (cosLat * 5040 * nu ** 7) * (61 + 662 * tanLat ** 2 + 1320 * tanLat ** 4 + 720 * tanLat ** 6);

  const osgbLat = lat - VII * dE ** 2 + VIII * dE ** 4 - IX   * dE ** 6;
  const osgbLon = lon0 + X * dE       - XI  * dE ** 3 + XII  * dE ** 5 - XIIA * dE ** 7;

  // Step 2: Helmert transform OSGB36 → WGS84 (7-parameter, ~5m accuracy)
  const sLat = Math.sin(osgbLat), cLat = Math.cos(osgbLat);
  const sLon = Math.sin(osgbLon), cLon = Math.cos(osgbLon);
  const nuA  = a / Math.sqrt(1 - e2 * sLat * sLat);

  const x1 = nuA * cLat * cLon;
  const y1 = nuA * cLat * sLon;
  const z1 = nuA * (1 - e2) * sLat;

  // Helmert params (OSGB36 → WGS84)
  const tx = 446.448, ty = -125.157, tz = 542.060;
  const rx = (0.1502 / 3600) * Math.PI / 180;
  const ry = (0.2470 / 3600) * Math.PI / 180;
  const rz = (0.8421 / 3600) * Math.PI / 180;
  const s  = -20.4894e-6;

  const x2 = tx + (1 + s) * ( x1 - rz * y1 + ry * z1);
  const y2 = ty + (1 + s) * ( rz * x1 + y1  - rx * z1);
  const z2 = tz + (1 + s) * (-ry * x1 + rx * y1 + z1 );

  // Step 3: Cartesian → WGS84 geodetic (iterative)
  const aW = 6378137.0, bW = 6356752.3142;
  const e2W = 1 - (bW * bW) / (aW * aW);
  const p   = Math.sqrt(x2 * x2 + y2 * y2);
  let latW  = Math.atan2(z2, p * (1 - e2W));
  for (let i = 0; i < 10; i++) {
    const nuW = aW / Math.sqrt(1 - e2W * Math.sin(latW) ** 2);
    latW = Math.atan2(z2 + e2W * nuW * Math.sin(latW), p);
  }
  const lonW = Math.atan2(y2, x2);

  return [
    Math.round(latW * 180 / Math.PI * 10000) / 10000,  // 4dp ≈ 11m precision
    Math.round(lonW * 180 / Math.PI * 10000) / 10000,
  ];
}

// ── Type code: P = Pole Mounted, G = Ground Mounted ──────────────────────
const typeCode = (t) => t.startsWith('Pole') ? 'P' : 'G';

// ── Main ──────────────────────────────────────────────────────────────────
async function main() {
  const rl = createInterface({ input: createReadStream(INPUT), crlfDelay: Infinity });
  const results = [];
  const seen = new Set();   // deduplicate by raw easting+northing
  let lineNo = 0, skipped = 0;

  for await (const line of rl) {
    lineNo++;
    if (lineNo === 1) continue; // header

    // CSV split — fields don't contain commas so simple split is fine
    const cols = line.split(',');
    const [owner, type, cls, number, status, , , area, locality, xStr, yStr] = cols;

    // Filter: SEPD owner, LV class, existing, south England only
    if (owner !== 'SEPD') { skipped++; continue; }
    if (cls   !== '11kV/LV') { skipped++; continue; }
    if (status !== 'Existing') { skipped++; continue; }
    if (EXCLUDE_AREAS.has(area)) { skipped++; continue; }

    const E = parseFloat(xStr);
    const N = parseFloat(yStr);
    if (!E || !N || isNaN(E) || isNaN(N)) { skipped++; continue; }

    // Sanity check — valid SEPD south England easting/northing range
    if (E < 80000 || E > 620000 || N < 80000 || N > 260000) { skipped++; continue; }

    // Deduplicate — SSEN source data contains exact duplicate rows
    const coordKey = `${xStr}|${yStr}`;
    if (seen.has(coordKey)) { skipped++; continue; }
    seen.add(coordKey);

    const [lat, lng] = bngToWgs84(E, N);

    // Compact record — keep it small
    results.push({
      lat,
      lng,
      t: typeCode(type),          // P or G
      n: (number || '').slice(0, 10),
      a: (area || '').slice(0, 30),
      l: (locality || '').slice(0, 30),
    });
  }

  mkdirSync(resolve(__dirname, '../public'), { recursive: true });
  writeFileSync(OUTPUT, JSON.stringify(results));

  const mb = (JSON.stringify(results).length / 1024 / 1024).toFixed(2);
  console.log(`✅ Done — ${results.toLocaleString?.() ?? results.length} LV substations written to public/ssen-lv-substations.json (${mb} MB)`);
  console.log(`   Skipped: ${skipped.toLocaleString?.() ?? skipped}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
