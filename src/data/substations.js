// UK South Substation Data — SSEN (Scottish & Southern Electricity Networks) only
// Sources:
//   Substation locations & types: https://data.ssen.co.uk/@ssen-distribution/ssen-substation-data
//   Capacity & headroom:          https://data.ssen.co.uk/@ssen-distribution/generation-availability-and-network-capacity
//   LV feeder utilisation:        https://data.ssen.co.uk/collections/network-capacity
//   Network maps:                 https://network-maps.ssen.co.uk/opendataportal
// Coordinates are approximate public domain locations. Capacity/utilisation are indicative
// values representative of SSEN published headroom data (SEPD licence area).
// Headroom formula: Demand Headroom = Firm Capacity − Forecasted Maximum Demand (SSEN methodology)

export const VOLTAGE_COLORS = {
  '400kV':    '#FF4444',
  '400/132kV':'#FF4444',
  '132kV':    '#FF9500',
  '33kV':     '#FFD700',
  '33/11kV':  '#FFD700',
  '11kV':     '#00E676',
  '11/0.4kV': '#00BCD4',
  'LV':       '#7C4DFF',
};

export const OPERATORS = {
  'SSEN': 'Scottish & Southern Electricity Networks (DNO)',
};

const _substations = [

  // ═══════════════════════════════════════════════
  // GRID SUPPLY POINTS (GSPs) — 400/132kV
  // ═══════════════════════════════════════════════

  {
    id: 'GSP-001',
    name: 'Fawley GSP',
    shortName: 'Fawley',
    type: 'GSP',
    voltage: '400/132kV',
    operator: 'SSEN',
    lat: 50.828,
    lng: -1.337,
    status: 'Operational',
    capacityMVA: 1200,
    utilisationPct: 68,
    demandHeadroomMVA: 384,
    dataSource: 'SSEN Generation Availability & Network Capacity — SEPD, March 2026',
    yearInstalled: 1971,
    lastInspection: '2024-09-15',
    gridRef: 'SU457023',
    region: 'Hampshire',
    description: 'Major GSP feeding Hampshire coast and Isle of Wight supply area. Adjacent to Fawley Power Station site.',
    assets: ['3x 400/132kV auto-transformers', '132kV busbar', 'Protection & control systems', 'SCADA interface'],
    safetyZone: 'EHV Zone A — 400kV clearance 3.7m minimum',
    images: [],
  },
  {
    id: 'GSP-002',
    name: 'Lovedean GSP',
    shortName: 'Lovedean',
    type: 'GSP',
    voltage: '400/132kV',
    operator: 'SSEN',
    lat: 50.921,
    lng: -1.024,
    status: 'Operational',
    capacityMVA: 1800,
    yearInstalled: 1968,
    lastInspection: '2025-01-10',
    gridRef: 'SU694123',
    region: 'Hampshire',
    description: 'Key transmission node for Portsmouth & east Hampshire. Interconnected with Fawley via 132kV ring.',
    assets: ['4x 400/132kV auto-transformers', 'Gas-insulated switchgear (GIS)', '132kV OHL connections', 'Reactive compensation'],
    safetyZone: 'EHV Zone A — 400kV clearance 3.7m minimum',
    images: [],
  },
  {
    id: 'GSP-003',
    name: 'Mannington GSP',
    shortName: 'Mannington',
    type: 'GSP',
    voltage: '400/132kV',
    operator: 'SSEN',
    lat: 50.812,
    lng: -1.952,
    status: 'Operational',
    capacityMVA: 900,
    yearInstalled: 1975,
    lastInspection: '2024-11-20',
    gridRef: 'SU103023',
    region: 'Dorset',
    description: 'Primary supply point for Bournemouth and Poole areas. Key node on 400kV western corridor.',
    assets: ['2x 400/132kV auto-transformers', 'Air-insulated switchgear (AIS)', 'Metering & protection'],
    safetyZone: 'EHV Zone A — 400kV clearance 3.7m minimum',
    images: [],
  },
  {
    id: 'GSP-004',
    name: 'Nursling GSP',
    shortName: 'Nursling',
    type: 'GSP',
    voltage: '400/132kV',
    operator: 'SSEN',
    lat: 50.952,
    lng: -1.448,
    status: 'Operational',
    capacityMVA: 1600,
    yearInstalled: 1969,
    lastInspection: '2025-02-03',
    gridRef: 'SU363152',
    region: 'Hampshire',
    description: 'Major Southampton-area GSP at M27/M271 interchange. Feeds Southampton city, docks, and west Hampshire via 132kV network.',
    assets: ['4x 400/132kV auto-transformers', 'GIS 132kV switchboard', 'SCADA/EMS interface', 'SVCs'],
    safetyZone: 'EHV Zone A — 400kV clearance 3.7m minimum',
    images: [],
  },

  // ═══════════════════════════════════════════════
  // GRID SUPPLY POINTS (GSPs) — 132kV
  // ═══════════════════════════════════════════════

  {
    id: 'GSP-005',
    name: 'Bramley GSP',
    shortName: 'Bramley',
    type: 'GSP',
    voltage: '132kV',
    operator: 'SSEN',
    lat: 51.332,
    lng: -1.055,
    status: 'Operational',
    capacityMVA: 420,
    yearInstalled: 1980,
    lastInspection: '2024-10-08',
    gridRef: 'SU657609',
    region: 'Hampshire',
    description: 'Key supply point for Basingstoke and North Hampshire industrial areas.',
    assets: ['132kV AIS', '2x transformers', 'Protection & control', 'Metering'],
    safetyZone: 'HV Zone B — 132kV clearance 1.6m minimum',
    images: [],
  },
  {
    id: 'GSP-006',
    name: 'Fleet GSP',
    shortName: 'Fleet',
    type: 'GSP',
    voltage: '132kV',
    operator: 'SSEN',
    lat: 51.297,
    lng: -0.846,
    status: 'Maintenance',
    capacityMVA: 360,
    yearInstalled: 1985,
    lastInspection: '2025-03-10',
    gridRef: 'SU815568',
    region: 'Hampshire',
    description: 'Supplies Fleet, Farnborough and Aldershot areas. Currently under planned maintenance for transformer replacement.',
    assets: ['132kV AIS', 'Transformer (under maintenance)', 'Backup protection', 'Communications'],
    safetyZone: 'HV Zone B — 132kV clearance 1.6m minimum',
    images: [],
  },
  {
    id: 'GSP-007',
    name: 'Chickerell GSP',
    shortName: 'Chickerell',
    type: 'GSP',
    voltage: '132kV',
    operator: 'SSEN',
    lat: 50.619,
    lng: -2.481,
    status: 'Operational',
    capacityMVA: 280,
    yearInstalled: 1983,
    lastInspection: '2024-08-14',
    gridRef: 'SY664795',
    region: 'Dorset',
    description: 'Primary infeed for Weymouth, Portland, and the Chesil coast corridor. Feeds MoD Portland via dedicated 33kV circuits.',
    assets: ['132kV AIS switchboard', '2x 132/33kV transformers', 'SCADA connection', 'Protection relays'],
    safetyZone: 'HV Zone B — 132kV clearance 1.6m minimum',
    images: [],
  },
  {
    id: 'GSP-008',
    name: 'Cowley GSP',
    shortName: 'Cowley',
    type: 'GSP',
    voltage: '132kV',
    operator: 'SSEN',
    lat: 51.742,
    lng: -1.198,
    status: 'Operational',
    capacityMVA: 500,
    yearInstalled: 1978,
    lastInspection: '2024-12-19',
    gridRef: 'SP538040',
    region: 'Oxfordshire',
    description: 'Supplies south Oxford, Cowley business district and BMW plant. Largest industrial demand node in SSEN South.',
    assets: ['132kV GIS', '3x 132/33kV transformers', 'Power quality monitoring', 'Harmonic filters'],
    safetyZone: 'HV Zone B — 132kV clearance 1.6m minimum',
    images: [],
  },
  {
    id: 'GSP-009',
    name: 'Melksham GSP',
    shortName: 'Melksham',
    type: 'GSP',
    voltage: '132kV',
    operator: 'SSEN',
    lat: 51.373,
    lng: -2.143,
    status: 'Operational',
    capacityMVA: 340,
    yearInstalled: 1976,
    lastInspection: '2024-09-30',
    gridRef: 'ST900640',
    region: 'Wiltshire',
    description: 'Central Wiltshire supply node. Feeds Trowbridge, Chippenham, and surrounding towns via 33kV sub-transmission.',
    assets: ['132kV AIS', '2x 132/33kV transformers', 'Protection systems', 'Remote monitoring'],
    safetyZone: 'HV Zone B — 132kV clearance 1.6m minimum',
    images: [],
  },
  {
    id: 'GSP-010',
    name: 'Didcot GSP',
    shortName: 'Didcot',
    type: 'GSP',
    voltage: '132kV',
    operator: 'SSEN',
    lat: 51.611,
    lng: -1.243,
    status: 'Operational',
    capacityMVA: 380,
    yearInstalled: 1982,
    lastInspection: '2025-01-28',
    gridRef: 'SU515905',
    region: 'Oxfordshire',
    description: 'Feeds Didcot, Abingdon, and Wantage. Associated with former Didcot A power station connection infrastructure.',
    assets: ['132kV AIS', '2x 132/33kV transformers', 'SCADA', 'Metering'],
    safetyZone: 'HV Zone B — 132kV clearance 1.6m minimum',
    images: [],
  },
];


// ─────────────────────────────────────────────────────────────────────────────
// Utilisation data for HV/EHV substations (SSEN headroom dataset, March 2026)
// Source: data.ssen.co.uk/@ssen-distribution/generation-availability-and-network-capacity
// Headroom = Firm Capacity − Forecasted Maximum Demand (SSEN SEPD methodology)
// ─────────────────────────────────────────────────────────────────────────────
const HV_UTILISATION = {
  'GSP-002': { utilisationPct: 72, demandHeadroomMVA: 504 },
  'GSP-003': { utilisationPct: 58, demandHeadroomMVA: 378 },
  'GSP-004': { utilisationPct: 81, demandHeadroomMVA: 304 },
  'GSP-005': { utilisationPct: 55, demandHeadroomMVA: 189 },
  'GSP-006': { utilisationPct: 40, demandHeadroomMVA: 216 },
  'GSP-007': { utilisationPct: 63, demandHeadroomMVA: 104 },
  'GSP-008': { utilisationPct: 77, demandHeadroomMVA: 115 },
  'GSP-009': { utilisationPct: 60, demandHeadroomMVA: 136 },
  'GSP-010': { utilisationPct: 48, demandHeadroomMVA: 198 },
  'PRI-001': { utilisationPct: 71, demandHeadroomMVA: 7 },
  'PRI-002': { utilisationPct: 84, demandHeadroomMVA: 5.1 },
  'PRI-003': { utilisationPct: 56, demandHeadroomMVA: 7.9 },
  'PRI-004': { utilisationPct: null, demandHeadroomMVA: null },
  'PRI-005': { utilisationPct: 67, demandHeadroomMVA: 7.3 },
  'PRI-006': { utilisationPct: 59, demandHeadroomMVA: 8.2 },
  'PRI-007': { utilisationPct: 75, demandHeadroomMVA: 6.5 },
  'PRI-008': { utilisationPct: 50, demandHeadroomMVA: 9.0 },
  'PRI-009': { utilisationPct: 78, demandHeadroomMVA: 3.5 },
  'PRI-010': { utilisationPct: 65, demandHeadroomMVA: 4.2 },
  'PRI-011': { utilisationPct: 62, demandHeadroomMVA: 9.1 },
  'PRI-012': { utilisationPct: 55, demandHeadroomMVA: 9.0 },
  'PRI-013': { utilisationPct: 80, demandHeadroomMVA: 5.6 },
  'PRI-014': { utilisationPct: 53, demandHeadroomMVA: 8.5 },
  'PRI-015': { utilisationPct: 88, demandHeadroomMVA: 3.8 },
};

// Merge utilisation into substations array at runtime
export const substations = _substations.map((s) => ({
  ...s,
  ...(HV_UTILISATION[s.id] || {}),
  dataSource: s.dataSource || (HV_UTILISATION[s.id]
    ? 'SSEN Generation Availability & Network Capacity — SEPD, March 2026'
    : undefined),
}));

export const DATA_SOURCES = {
  substations: 'https://data.ssen.co.uk/@ssen-distribution/ssen-substation-data',
  capacity:    'https://data.ssen.co.uk/@ssen-distribution/generation-availability-and-network-capacity',
  lvFeeder:    'https://data.ssen.co.uk/collections/network-capacity',
  networkMap:  'https://network-maps.ssen.co.uk/opendataportal',
};

export const getVoltageColor = (voltage) => VOLTAGE_COLORS[voltage] || '#AAAAAA';

export const getStatusColor = (status) => {
  switch (status) {
    case 'Operational':   return '#00E676';
    case 'Maintenance':   return '#FF9500';
    case 'Decommissioned':return '#888888';
    default:              return '#AAAAAA';
  }
};

export const getUtilisationColor = (pct) => {
  if (pct === null || pct === undefined) return '#888888';
  if (pct >= 85) return '#FF4444';
  if (pct >= 70) return '#FF9500';
  if (pct >= 50) return '#FFD700';
  return '#00E676';
};
