/**
 * Simplifies SEPD primary substation GeoJSON boundaries.
 * Reduces coordinate precision and applies Douglas-Peucker thinning.
 * Output is ~10x smaller while preserving visible shape at map zoom 8-12.
 */
import { readFileSync, writeFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const INPUT  = resolve(__dirname, '../manual_data/sepd_primarysubstation_esa_2025.geojson');
const OUTPUT = resolve(__dirname, '../public/sepd-primary-boundaries.geojson');

// Douglas-Peucker line simplification
function perpendicularDistance([px, py], [ax, ay], [bx, by]) {
  const dx = bx - ax, dy = by - ay;
  if (dx === 0 && dy === 0) return Math.hypot(px - ax, py - ay);
  const t = ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy);
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

function douglasPeucker(points, tolerance) {
  if (points.length <= 2) return points;
  let maxDist = 0, maxIdx = 0;
  for (let i = 1; i < points.length - 1; i++) {
    const d = perpendicularDistance(points[i], points[0], points[points.length - 1]);
    if (d > maxDist) { maxDist = d; maxIdx = i; }
  }
  if (maxDist > tolerance) {
    const left  = douglasPeucker(points.slice(0, maxIdx + 1), tolerance);
    const right = douglasPeucker(points.slice(maxIdx), tolerance);
    return [...left.slice(0, -1), ...right];
  }
  return [points[0], points[points.length - 1]];
}

const TOLERANCE = 0.0005; // ~55m in degrees — fine for zoom 8-12
const PRECISION = 4;       // 4dp ≈ 11m

const round = (n) => Math.round(n * 10 ** PRECISION) / 10 ** PRECISION;

function simplifyRing(ring) {
  const simplified = douglasPeucker(ring, TOLERANCE);
  // Ensure ring is closed
  if (simplified[0][0] !== simplified[simplified.length-1][0]) simplified.push(simplified[0]);
  // Must have at least 4 points for a valid ring
  if (simplified.length < 4) return ring.map(([x,y]) => [round(x), round(y)]);
  return simplified.map(([x, y]) => [round(x), round(y)]);
}

function simplifyGeometry(geom) {
  if (!geom) return geom;
  if (geom.type === 'Polygon') {
    return { type: 'Polygon', coordinates: geom.coordinates.map(simplifyRing) };
  }
  if (geom.type === 'MultiPolygon') {
    return { type: 'MultiPolygon', coordinates: geom.coordinates.map(poly => poly.map(simplifyRing)) };
  }
  return geom;
}

// Only keep properties we need in the app
const KEEP_PROPS = ['GSP_NAME','GSP_Alias','BSP_NAME','BSP_ALIAS','BSP_VOLTAGE_STEP',
  'PRIMARY_NRN_SPLIT','PRIMARY_NAME_2025','PRIMARY_VOLTAGE_STEP'];

const gj = JSON.parse(readFileSync(INPUT, 'utf8'));
const simplified = {
  type: 'FeatureCollection',
  features: gj.features.map(f => ({
    type: 'Feature',
    properties: Object.fromEntries(KEEP_PROPS.map(k => [k, f.properties[k] ?? null])),
    geometry: simplifyGeometry(f.geometry),
  })),
};

const out = JSON.stringify(simplified);
writeFileSync(OUTPUT, out);
const mb = (out.length / 1024 / 1024).toFixed(2);
console.log(`✅ Simplified GeoJSON written (${mb} MB, ${simplified.features.length} features)`);
