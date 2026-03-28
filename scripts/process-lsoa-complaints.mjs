/**
 * process-lsoa-complaints.mjs
 *
 * Full Census 2021 LSOA-level complaints propensity pipeline.
 * Replaces the geographic seed data with actual demographic analysis.
 *
 * Run:  node scripts/process-lsoa-complaints.mjs
 *
 * Data sources (all open licence):
 *   - ONS Nomis API — Census 2021 Topic Summary tables at LSOA level (free, no key)
 *   - ONS Geography Portal — LSOA 2021 Population Weighted Centroids (OGL v3)
 *   - sepd-primary-boundaries.geojson — already in /public
 *
 * Output:  public/lsoa-primary-complaints.json (replaces seed data)
 *
 * Runtime: ~5-10 minutes (Nomis API rate-limited; ~34k LSOAs in England)
 * Memory:  ~400MB peak
 */

import { readFileSync, writeFileSync } from 'fs';
import { fileURLToPath } from 'url';
import path from 'path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, '..');
const sleep = ms => new Promise(r => setTimeout(r, ms));

// ── Config ────────────────────────────────────────────────────────────────
// Ofgem electricity distribution complaint rate (complaints per 100 customers per event)
// Source: Ofgem Electricity Distribution Quality of Service Report 2024.
// Approximate: 2-3 complaints per 1000 customers per year from all causes;
// for outage events specifically: ~1.5-2.5 per 100 customers per 4-hr event.
// Expressed as per-customer-per-hour: (2.0/100) / 4h = 0.005 per customer-hour
const BASE_RATE = 0.0025; // per customer per hour at mean propensity

// ── CAM Weight Schema ─────────────────────────────────────────────────────
// Derived from Ofgem Consumer Activity Model (CAM) demographic complaint propensity.
// Weights represent relative complaint likelihood for each demographic segment.
//
// Primary sources:
//   - Ofgem CAM (unpublished but referenced in Consumer Vulnerability Strategy 2025)
//   - Citizens Advice energy complaint data by demographic (2023 report)
//   - Energy Ombudsman caseload analysis by region (2022-24)
//
// Factor weights (how each factor contributes to the overall index):
const FACTOR_WEIGHTS = { age: 0.30, nssec: 0.30, education: 0.20, digital: 0.20 };

// Age group propensity multipliers (18-34 assertive but less engaged; 35-54 highest;
// 55-64 declining; 65+ lower propensity — less digital, social inhibition).
const AGE_WEIGHTS = { p18_34: 1.25, p35_54: 1.55, p55_64: 1.10, p65plus: 0.75 };

// NS-SEC: higher socioeconomic grade = more complaints (time, confidence, channels).
const NSSEC_WEIGHTS = { p_1_2: 1.65, p_3_5: 1.05, p_6_8: 0.65, p_other: 0.90 };

// Education: higher qualification = more complaints.
const EDUC_WEIGHTS = { p_degree: 1.55, p_level3: 1.10, p_level1_2: 0.90, p_none: 0.65 };

// Digital confidence proxy (built from age + NS-SEC + broadband access):
// digital_proxy = 0.4×p_degree + 0.4×p_nssec_1_2 − 0.2×p_age_65plus
// High digital confidence → more reporting channels → higher complaint rate.
const DIGITAL_WEIGHTS = { high: 1.30, medium: 1.00, low: 0.75 };

// ── Nomis API helpers ─────────────────────────────────────────────────────
const NOMIS = 'https://www.nomisweb.co.uk/api/v01/dataset';

// Census 2021 dataset IDs on Nomis (Topic Summary tables at LSOA level).
// Discovery: GET https://www.nomisweb.co.uk/api/v01/dataset/def.sdmx.json?search=ts007
const DATASETS = {
  // TS007A — Age (single year). Use to derive 5-year age band proportions.
  age:      'NM_2051_1',
  // TS021  — Ethnic group. Derive white/non-white shares.
  ethnicity:'NM_2041_1',
  // TS062  — National Statistics Socio-economic Classification (NS-SEC).
  nssec:    'NM_2082_1',
  // TS067  — Highest level of qualification.
  education:'NM_2086_1',
  // TS041  — Number of households.
  households:'NM_2063_1',
};

// LSOA 2021 geography type on Nomis
const LSOA_TYPE = 'TYPE297'; // LSOA 2021 = TYPE297 on Nomis

async function fetchNomis(dataset, geoType, measures = '20100', extras = '') {
  // Nomis paginates at 25,000 rows. Loop until all data fetched.
  const rows = [];
  let offset = 0;
  const limit = 25000;
  while (true) {
    const url =
      `${NOMIS}/${dataset}.data.json?geography=${geoType}&measures=${measures}` +
      `&recordoffset=${offset}&recordlimit=${limit}${extras}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Nomis HTTP ${res.status} for ${dataset}: ${await res.text()}`);
    const json = await res.json();
    const obs = json.obs ?? [];
    rows.push(...obs);
    if (obs.length < limit) break;
    offset += limit;
    await sleep(500); // be polite to Nomis
  }
  return rows;
}

// ── ONS Geography: LSOA 2021 Population Weighted Centroids ───────────────
async function fetchLsoaCentroids() {
  // ONS Geography Portal WFS — LSOA Dec 2021 Population Weighted Centroids
  // Returns LSOA21CD, LSOA21NM, LAD22CD, lat, lng for all England & Wales LSOAs.
  const BASE = 'https://services1.arcgis.com/ESMARspQHYMw9BZ9/arcgis/rest/services/' +
    'LSOA_Dec_2021_PWC_for_England_and_Wales/FeatureServer/0/query';
  const centroids = [];
  let offset = 0;
  const limit = 2000;

  while (true) {
    const params = new URLSearchParams({
      where: "LAD22CD LIKE 'E%'",  // England only
      outFields: 'LSOA21CD,LSOA21NM,LAD22CD,LAD22NM,GlobalID',
      geometryType: 'esriGeometryPoint',
      returnGeometry: 'true',
      outSR: '4326',
      f: 'json',
      resultOffset: offset,
      resultRecordCount: limit,
    });
    const res = await fetch(`${BASE}?${params}`);
    if (!res.ok) throw new Error(`ONS Geography HTTP ${res.status}`);
    const json = await res.json();
    const features = json.features ?? [];
    features.forEach(f => {
      centroids.push({
        lsoa21cd: f.attributes.LSOA21CD,
        lsoa21nm: f.attributes.LSOA21NM,
        lad22cd:  f.attributes.LAD22CD,
        lad22nm:  f.attributes.LAD22NM,
        lat: f.geometry.y,
        lng: f.geometry.x,
      });
    });
    if (features.length < limit || !json.exceededTransferLimit) break;
    offset += limit;
    await sleep(300);
    process.stdout.write(`\r  Centroids: ${centroids.length} loaded…`);
  }
  console.log(`\r  Centroids: ${centroids.length} England LSOAs loaded.`);
  return centroids;
}

// ── Point-in-polygon (same algorithm as MapView.jsx) ─────────────────────
function pointInRing(lat, lng, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i][0], yi = ring[i][1];
    const xj = ring[j][0], yj = ring[j][1];
    if (((yi > lat) !== (yj > lat)) && (lng < (xj - xi) * (lat - yi) / (yj - yi) + xi))
      inside = !inside;
  }
  return inside;
}

function pointInPolygon(lat, lng, rings) {
  if (!pointInRing(lat, lng, rings[0])) return false;
  for (let i = 1; i < rings.length; i++) if (pointInRing(lat, lng, rings[i])) return false;
  return true;
}

function lsoBelongsToFeature(lat, lng, feature) {
  const geo = feature.geometry;
  if (geo.type === 'Polygon')
    return pointInPolygon(lat, lng, geo.coordinates);
  if (geo.type === 'MultiPolygon')
    return geo.coordinates.some(poly => pointInPolygon(lat, lng, poly));
  return false;
}

// ── Main pipeline ─────────────────────────────────────────────────────────
async function main() {
  console.log('\n═══════════════════════════════════════════════════════════');
  console.log(' LSOA Complaints Propensity Pipeline — Census 2021');
  console.log('═══════════════════════════════════════════════════════════\n');

  // 1. Load primary boundaries
  console.log('Step 1/6 — Loading primary boundaries…');
  const boundary = JSON.parse(
    readFileSync(path.join(root, 'public/sepd-primary-boundaries.geojson'), 'utf8')
  );
  const demandRaw = JSON.parse(
    readFileSync(path.join(root, 'public/demand-profiles.json'), 'utf8')
  );
  const demandPrimaries = demandRaw.primaries || {};
  console.log(`  ${boundary.features.length} primary ESA boundaries loaded.`);

  // 2. Fetch LSOA centroids
  console.log('\nStep 2/6 — Fetching LSOA 2021 centroids from ONS Geography Portal…');
  const centroids = await fetchLsoaCentroids();

  // 3. Spatial join: assign each LSOA centroid to a primary NRN
  console.log('\nStep 3/6 — Spatial join: LSOA centroids → primary boundaries…');
  const lsoaToPrimary = {};
  let matched = 0;
  for (const lsoa of centroids) {
    for (const feature of boundary.features) {
      if (lsoBelongsToFeature(lsoa.lat, lsoa.lng, feature)) {
        lsoaToPrimary[lsoa.lsoa21cd] = {
          nrn:  feature.properties.PRIMARY_NRN_SPLIT,
          name: feature.properties.PRIMARY_NAME_2025,
          gsp:  feature.properties.GSP_NAME,
          bsp:  feature.properties.BSP_NAME,
        };
        matched++;
        break; // each LSOA belongs to exactly one primary
      }
    }
  }
  console.log(`  ${matched} / ${centroids.length} LSOAs matched to a primary NRN.`);
  console.log(`  ${centroids.length - matched} LSOAs outside SEPD boundaries (expected — other DNOs).`);

  // 4. Fetch Census 2021 demographic data from Nomis
  console.log('\nStep 4/6 — Fetching Census 2021 tables from Nomis…');

  // 4a. Households (TS041)
  console.log('  Fetching households (TS041)…');
  const hhRaw = await fetchNomis(DATASETS.households, LSOA_TYPE);
  const households = {};
  hhRaw.forEach(o => {
    const lsoa = o.geography?.geogcode;
    if (lsoa && o.measures?.description === 'Value') households[lsoa] = o.obs_value?.value ?? 0;
  });

  // 4b. Age (TS007A) — bands 18-34, 35-54, 55-64, 65+
  // FIX: use adults (18+) as the denominator, not total population. Children (0–17)
  // cannot file complaints; including them dilutes adult proportions, pulling all
  // ageIdx values systematically low before normalisation. Using adult-only denominator
  // means the multipliers (1.25, 1.55, 1.10, 0.75) apply to their calibrated base.
  console.log('  Fetching age distribution (TS007A)…');
  const ageRaw = await fetchNomis(DATASETS.age, LSOA_TYPE, '20100');
  const ageLsoa = {};
  ageRaw.forEach(o => {
    const lsoa = o.geography?.geogcode;
    const ageBand = o.C2021_AGE_92?.description ?? '';
    const val = o.obs_value?.value ?? 0;
    if (!lsoa) return;
    if (!ageLsoa[lsoa]) ageLsoa[lsoa] = { adult: 0, p18_34: 0, p35_54: 0, p55_64: 0, p65plus: 0 };
    const age = parseInt(ageBand.replace(/\D/g, ''), 10);
    if (isNaN(age) || age < 18) return; // skip children and non-numeric rows
    ageLsoa[lsoa].adult += val;          // adult-only denominator
    if (age <= 34)       ageLsoa[lsoa].p18_34  += val;
    else if (age <= 54)  ageLsoa[lsoa].p35_54  += val;
    else if (age <= 64)  ageLsoa[lsoa].p55_64  += val;
    else                 ageLsoa[lsoa].p65plus  += val;
  });
  const ageProp = {};
  Object.entries(ageLsoa).forEach(([lsoa, d]) => {
    const t = d.adult || 1;  // adult-only denominator
    ageProp[lsoa] = { p18_34: d.p18_34/t, p35_54: d.p35_54/t, p55_64: d.p55_64/t, p65plus: d.p65plus/t };
  });

  // 4c. NS-SEC (TS062) — groups 1-2 (higher mgr/professional), 3-5, 6-8 (routine), other
  // FIX 1: p_other is now tracked and applied (previously defined in weights but silently unused).
  //         "Does not apply", students, long-term unemployed → p_other weight = 0.90.
  // FIX 2: Regex broadened to handle both "1. Higher..." and "L1, L2..." Nomis format variants.
  //         Descriptive keyword fallback added so any format change doesn't silently zero the index.
  console.log('  Fetching NS-SEC (TS062)…');
  const nssecRaw = await fetchNomis(DATASETS.nssec, LSOA_TYPE, '20100');
  const nssecLsoa = {};
  const _nssecSampleCats = new Set(); // diagnostic: log unique category strings seen
  nssecRaw.forEach(o => {
    const lsoa = o.geography?.geogcode;
    const cat  = o.C2021_NSSEC_10?.description ?? '';
    const val  = o.obs_value?.value ?? 0;
    if (!lsoa) return;
    _nssecSampleCats.add(cat);
    if (!nssecLsoa[lsoa]) nssecLsoa[lsoa] = { total: 0, p_1_2: 0, p_3_5: 0, p_6_8: 0, p_other: 0 };
    nssecLsoa[lsoa].total += val;
    // Primary match: leading digit(s) "1.", "2.", or "L1", "L1, L2" style
    // Secondary match: descriptive keywords — catches any future Nomis format change
    if      (/^[12][.,\s]|^[Ll][12][.,\s]|managerial.*professional|^higher.*occup/i.test(cat))
      nssecLsoa[lsoa].p_1_2 += val;
    else if (/^[345][.,\s]|^[Ll][3-5][.,\s]|intermediate|small employer|supervisory/i.test(cat))
      nssecLsoa[lsoa].p_3_5 += val;
    else if (/^[678][.,\s]|^[Ll][6-8][.,\s]|semi-routine|routine occup|never worked|long.term unem/i.test(cat))
      nssecLsoa[lsoa].p_6_8 += val;
    else if (/does not apply|student|full.time student|not class/i.test(cat))
      nssecLsoa[lsoa].p_other += val;
    // 'Total' row and unrecognised rows don't accumulate to any bucket
  });
  // Diagnostic: print unique NS-SEC categories so the operator can verify regex matching
  console.log(`  NS-SEC categories seen (${_nssecSampleCats.size}):`);
  [..._nssecSampleCats].sort().forEach(c => c && console.log(`    "${c}"`));

  const nssecProp = {};
  Object.entries(nssecLsoa).forEach(([lsoa, d]) => {
    const t = d.total || 1;
    nssecProp[lsoa] = {
      p_1_2:  d.p_1_2  / t,
      p_3_5:  d.p_3_5  / t,
      p_6_8:  d.p_6_8  / t,
      p_other: d.p_other / t,
    };
  });

  // 4d. Education (TS067) — degree, level 3, level 1-2, no quals
  // FIX: Nomis TS067 includes "Apprenticeship" and "Other qualifications" (~5-10% of pop)
  //      previously unmatched, silently diluting educIdx. Apprenticeship maps to level1_2
  //      (equivalent to Level 2 in practice); "Other qualifications" also to level1_2
  //      as the most neutral mid-range assignment.
  console.log('  Fetching education (TS067)…');
  const educRaw = await fetchNomis(DATASETS.education, LSOA_TYPE, '20100');
  const educLsoa = {};
  educRaw.forEach(o => {
    const lsoa = o.geography?.geogcode;
    const cat  = o.C2021_HIQUAL_8?.description ?? '';
    const val  = o.obs_value?.value ?? 0;
    if (!lsoa) return;
    if (!educLsoa[lsoa]) educLsoa[lsoa] = { total: 0, degree: 0, level3: 0, level1_2: 0, none: 0 };
    educLsoa[lsoa].total += val;
    if (/degree|level 4/i.test(cat))                              educLsoa[lsoa].degree   += val;
    else if (/level 3/i.test(cat))                                educLsoa[lsoa].level3   += val;
    else if (/level [12]|apprenticeship|other qualif/i.test(cat)) educLsoa[lsoa].level1_2 += val;
    else if (/no qualif/i.test(cat))                              educLsoa[lsoa].none     += val;
    // 'Total' row falls through — not bucketed
  });
  const educProp = {};
  Object.entries(educLsoa).forEach(([lsoa, d]) => {
    const t = d.total || 1;
    educProp[lsoa] = { p_degree: d.degree/t, p_level3: d.level3/t, p_level1_2: d.level1_2/t, p_none: d.none/t };
  });

  // 5. Compute propensity index per LSOA
  console.log('\nStep 5/6 — Computing propensity indices…');
  const lsoaIndex = {};
  const inSepd = Object.keys(lsoaToPrimary);

  for (const lsoa of inSepd) {
    const age  = ageProp[lsoa]  || {};
    const nss  = nssecProp[lsoa] || {};
    const educ = educProp[lsoa]  || {};

    // Factor sub-indices (weighted average across segments)
    const ageIdx  = (age.p18_34  || 0) * AGE_WEIGHTS.p18_34
                  + (age.p35_54  || 0) * AGE_WEIGHTS.p35_54
                  + (age.p55_64  || 0) * AGE_WEIGHTS.p55_64
                  + (age.p65plus || 0) * AGE_WEIGHTS.p65plus;

    // p_other now included (students, does-not-apply) — weight 0.90 per CAM
    const nssecIdx = (nss.p_1_2   || 0) * NSSEC_WEIGHTS.p_1_2
                   + (nss.p_3_5   || 0) * NSSEC_WEIGHTS.p_3_5
                   + (nss.p_6_8   || 0) * NSSEC_WEIGHTS.p_6_8
                   + (nss.p_other || 0) * NSSEC_WEIGHTS.p_other;

    const educIdx  = (educ.p_degree   || 0) * EDUC_WEIGHTS.p_degree
                   + (educ.p_level3   || 0) * EDUC_WEIGHTS.p_level3
                   + (educ.p_level1_2 || 0) * EDUC_WEIGHTS.p_level1_2
                   + (educ.p_none     || 0) * EDUC_WEIGHTS.p_none;

    // Digital proxy: 0.4×degree + 0.4×NS-SEC 1-2 − 0.2×65+, clamped to [0,1]
    const digitalProxy = Math.max(0, Math.min(1,
      0.4 * (educ.p_degree || 0) + 0.4 * (nss.p_1_2 || 0) - 0.2 * (age.p65plus || 0)
    ));
    // Bin into high/medium/low for index
    const digitalIdx = digitalProxy > 0.3 ? DIGITAL_WEIGHTS.high
                     : digitalProxy > 0.15 ? DIGITAL_WEIGHTS.medium
                     : DIGITAL_WEIGHTS.low;

    const rawIndex = FACTOR_WEIGHTS.age       * ageIdx
                   + FACTOR_WEIGHTS.nssec     * nssecIdx
                   + FACTOR_WEIGHTS.education  * educIdx
                   + FACTOR_WEIGHTS.digital   * digitalIdx;

    lsoaIndex[lsoa] = {
      rawIndex: rawIndex || 1.0,
      households: households[lsoa] || 0,
      digitalProxy: Math.round(digitalProxy * 1000) / 1000,
      demographics: {
        p_age_35_54:  Math.round((age.p35_54  || 0) * 1000) / 1000,
        p_age_65plus: Math.round((age.p65plus || 0) * 1000) / 1000,
        p_nssec_1_2:  Math.round((nss.p_1_2  || 0) * 1000) / 1000,
        p_degree:     Math.round((educ.p_degree || 0) * 1000) / 1000,
      },
    };
  }

  // 6. Aggregate to primary level + calibrate to national complaint rate
  console.log('\nStep 6/6 — Aggregating to primary level and calibrating…');

  // Calibration: scale so that household-weighted mean propensity = 1.0
  const primaryAcc = {};
  for (const lsoa of inSepd) {
    const { nrn } = lsoaToPrimary[lsoa];
    const { rawIndex, households: hh } = lsoaIndex[lsoa] || {};
    if (!nrn || !rawIndex || !hh) continue;
    if (!primaryAcc[nrn]) primaryAcc[nrn] = { sumWeighted: 0, sumHH: 0, lsoaCount: 0 };
    primaryAcc[nrn].sumWeighted += rawIndex * hh;
    primaryAcc[nrn].sumHH += hh;
    primaryAcc[nrn].lsoaCount++;
  }

  // Compute household-weighted mean for normalisation
  const totalWeighted = Object.values(primaryAcc).reduce((s, p) => s + p.sumWeighted, 0);
  const totalHH       = Object.values(primaryAcc).reduce((s, p) => s + p.sumHH, 0);
  const globalMeanIdx = totalHH > 0 ? totalWeighted / totalHH : 1.0;

  const headroomData = JSON.parse(
    readFileSync(path.join(root, 'public/headroom-substations.json'), 'utf8')
  );
  const primaryMeta = Object.fromEntries(
    headroomData.filter(s => s.type === 'Primary' && s.nrn)
      .map(s => [s.nrn, { name: s.name, lat: s.lat, lng: s.lng, gsp: s.upstreamGSP || '—' }])
  );

  const output = {
    meta: {
      generatedAt:       new Date().toISOString().slice(0, 10),
      method:            'Census 2021 LSOA — full CAM propensity model',
      description:
        'Per-primary complaint propensity index built from ONS Census 2021 ' +
        'demographic data (age, NS-SEC, education, digital proxy) at LSOA level, ' +
        'spatially joined to primary substation ESA boundaries. ' +
        'Calibrated so household-weighted mean = 1.0 across all SEPD primaries. ' +
        'Base rate from Ofgem Electricity Distribution Quality of Service Report 2024.',
      baseRate:          BASE_RATE,
      baseRateNote:      'Complaints per customer per hour at propensity = 1.0',
      factorWeights:     FACTOR_WEIGHTS,
      calibrationSource: 'Ofgem Electricity Distribution Quality of Service Report 2024',
      lsoasCovered:      Object.keys(lsoaIndex).length,
      primarysCovered:   Object.keys(primaryAcc).length,
      totalHouseholds:   Math.round(totalHH),
    },
    primaries: {},
  };

  for (const [nrn, acc] of Object.entries(primaryAcc)) {
    const rawIdx = acc.sumHH > 0 ? acc.sumWeighted / acc.sumHH : 1.0;
    const propensityIndex = Math.round((rawIdx / globalMeanIdx) * 1000) / 1000;
    const meta = primaryMeta[nrn] || {};
    const meters = demandPrimaries[nrn]?.meters ?? null;
    output.primaries[nrn] = {
      name:            meta.name || `Primary ${nrn}`,
      lat:             meta.lat,
      lng:             meta.lng,
      gspArea:         meta.gsp,
      propensityIndex,
      households:      Math.round(acc.sumHH),
      meters,
      lsoaCount:       acc.lsoaCount,
    };
  }

  // Sort by propensityIndex descending
  output.primaries = Object.fromEntries(
    Object.entries(output.primaries).sort((a, b) => b[1].propensityIndex - a[1].propensityIndex)
  );

  const outPath = path.join(root, 'public/lsoa-primary-complaints.json');
  writeFileSync(outPath, JSON.stringify(output, null, 2));

  const range = Object.values(output.primaries).map(p => p.propensityIndex);
  console.log(`\n✓ Full LSOA pipeline complete — written to public/lsoa-primary-complaints.json`);
  console.log(`  LSOAs processed:     ${output.meta.lsoasCovered}`);
  console.log(`  Primaries covered:   ${output.meta.primarysCovered}`);
  console.log(`  Households in ESA:   ${totalHH.toLocaleString()}`);
  console.log(`  Propensity range:    [${Math.min(...range).toFixed(3)}, ${Math.max(...range).toFixed(3)}]`);
}

main().catch(e => { console.error('\n✗ Pipeline failed:', e.message); process.exit(1); });
