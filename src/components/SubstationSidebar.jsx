import { useState, useEffect } from 'react';
import { MapContainer, TileLayer, CircleMarker } from 'react-leaflet';
import {
  BarChart, Bar, LineChart, Line,
  XAxis, YAxis, CartesianGrid, Tooltip as RechartTooltip,
  ResponsiveContainer, Cell, Legend as RechartLegend,
} from 'recharts';
import 'leaflet/dist/leaflet.css';
import { getVoltageColor, getStatusColor } from '../data/substations';

// ── Smart-meter demand cache ───────────────────────────────────────────────
// Single file: { date, timestamps[48], primaries: { nrn: { kW[48], meters, transformers:{id:{name,kW[48]}} } } }
let _demandCache = null;
async function loadDemandProfiles() {
  if (!_demandCache) {
    const r = await fetch('/demand-profiles.json');
    _demandCache = await r.json();
  }
  return _demandCache;
}

// ── DFES data cache (shared across sidebar instances) ─────────────────────
let _dfesCache = null;
let _dfesLicenceCache = null;

async function loadDfes() {
  if (!_dfesCache) {
    const [r1, r2] = await Promise.all([
      fetch('/dfes-by-primary.json'),
      fetch('/dfes-licence.json'),
    ]);
    _dfesCache        = await r1.json();
    _dfesLicenceCache = await r2.json();
  }
  return { byPrimary: _dfesCache, licence: _dfesLicenceCache };
}

// Normalise substation name → DFES primary key
const normPrimary = (name = '') =>
  name.toUpperCase()
    .replace(/\s+(PRIMARY|GSP|BSP|SUBSTATION)$/,'')
    .trim();

// ── Helpers ───────────────────────────────────────────────────────────────
const RAG_COLOR = { Red: '#FF4444', Amber: '#FF9500', Green: '#00E676' };
const ragColor  = (rag) => RAG_COLOR[rag] || '#888';
const ragBg     = (rag) => ({ Red: 'rgba(255,68,68,0.15)', Amber: 'rgba(255,149,0,0.15)', Green: 'rgba(0,230,118,0.15)' }[rag] || 'rgba(255,255,255,0.05)');

// ── Transformer rating sanitisation ───────────────────────────────────────
// Source CSV sometimes puts internal reference IDs (e.g. 85777) in the rating
// field. Any plain integer > 999 with no unit is treated as invalid.
function defaultRating(voltage = '') {
  const hv = String(voltage).split('/')[0].trim();
  if (['400', '275'].includes(hv)) return voltage.includes('66') ? '2 × 120MVA' : '2 × 240MVA';
  if (hv === '132') return voltage.includes('11') ? '2 × 40MVA' : '2 × 60MVA';
  if (hv === '66')  return '2 × 40MVA';
  return '2 × 10MVA';
}
export function sanitizeRating(rating, voltage) {
  if (!rating) return null;
  const str = String(rating);
  if (str.includes('MVA') || str.includes('×') || str.includes('x')) return str;
  const num = parseFloat(str);
  if (!isNaN(num) && num > 999) return `${defaultRating(voltage)} (default — source value invalid)`;
  return str;
}

function SatelliteMiniMap({ lat, lng, voltageColor }) {
  return (
    <div className="minimap-wrapper">
      <MapContainer key={`${lat}-${lng}`} center={[lat, lng]} zoom={16}
        zoomControl={false} scrollWheelZoom={false} dragging={false}
        doubleClickZoom={false} attributionControl={false}
        style={{ height: 160, width: '100%', borderRadius: 8, pointerEvents: 'none' }}>
        <TileLayer url="https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}" />
        <CircleMarker center={[lat, lng]} radius={10} color="#fff" weight={2} fillColor={voltageColor} fillOpacity={0.9} />
      </MapContainer>
      <div className="minimap-links">
        <a href={`https://www.google.com/maps/@${lat},${lng},17z/data=!3m1!1e3`} target="_blank" rel="noopener noreferrer" className="minimap-link">🛰 Satellite</a>
        <a href={`https://www.google.com/maps/@?api=1&map_action=pano&viewpoint=${lat},${lng}`} target="_blank" rel="noopener noreferrer" className="minimap-link">🚶 Street View</a>
      </div>
    </div>
  );
}

function InfoRow({ label, value, valueColor }) {
  if (!value && value !== 0) return null;
  return (
    <div className="info-row">
      <span className="info-label">{label}</span>
      <span className="info-value" style={valueColor ? { color: valueColor } : {}}>{value}</span>
    </div>
  );
}

function RAGBadge({ label, rag }) {
  if (!rag) return null;
  return (
    <div className="rag-badge" style={{ background: ragBg(rag), border: `1px solid ${ragColor(rag)}` }}>
      <span className="rag-dot" style={{ background: ragColor(rag) }} />
      <span className="rag-label">{label}</span>
      <span className="rag-value" style={{ color: ragColor(rag) }}>{rag}</span>
    </div>
  );
}

// ── Tab: Details ──────────────────────────────────────────────────────────
function DetailsTab({ sub, voltageColor, statusColor, onAskChatbot }) {
  return (
    <>
      <section className="sidebar-section" style={{ paddingBottom: 0 }}>
        <h3 className="section-title">Satellite View</h3>
        <SatelliteMiniMap lat={sub.lat} lng={sub.lng} voltageColor={voltageColor} />
      </section>

      <section className="sidebar-section">
        <h3 className="section-title">Asset Details</h3>
        <InfoRow label="Type"            value={sub.type} />
        <InfoRow label="Voltage"         value={sub.voltage ? `${sub.voltage} kV` : sub.voltage} />
        <InfoRow label="Grid Ref"        value={sub.gridRef} />
        <InfoRow label="Region"          value={sub.region} />
        <InfoRow label="Year Installed"  value={sub.yearInstalled} />
        <InfoRow label="Last Inspection" value={sub.lastInspection} />
        <InfoRow label="Transformer"     value={sanitizeRating(sub.transformerRating, sub.voltage)} />
        <InfoRow label="Upstream GSP"    value={sub.upstreamGSP} />
        <InfoRow label="Upstream BSP"    value={sub.upstreamBSP} />
        <InfoRow label="Coordinates"     value={`${sub.lat?.toFixed(4)}°N, ${Math.abs(sub.lng)?.toFixed(4)}°${sub.lng < 0 ? 'W' : 'E'}`} />
      </section>

      {sub.description && (
        <section className="sidebar-section">
          <h3 className="section-title">Description</h3>
          <p className="section-text">{sub.description}</p>
        </section>
      )}

      {sub.assets?.length > 0 && (
        <section className="sidebar-section">
          <h3 className="section-title">Key Assets</h3>
          <ul className="asset-list">
            {sub.assets.map((a, i) => <li key={i} className="asset-item"><span className="asset-bullet">▸</span> {a}</li>)}
          </ul>
        </section>
      )}

      <section className="sidebar-section safety-section">
        <h3 className="section-title">⚡ Safety Zone</h3>
        <p className="safety-text">{sub.safetyZone}</p>
        <button className="btn btn-outline" onClick={() => onAskChatbot(`What safety precautions are required when working at a ${sub.voltage} ${sub.type} substation like ${sub.name}? Reference UK safety standards including ENA Safety Rules and EaWR 1989.`)}>
          Ask Safety Assistant
        </button>
      </section>
    </>
  );
}

// ── Tab: Headroom ─────────────────────────────────────────────────────────
function HeadroomTab({ sub }) {
  const hasData = sub.demandRAG || sub.genRAG || sub.maxDemand != null;
  if (!hasData) return (
    <section className="sidebar-section">
      <p className="section-text" style={{ opacity: 0.5 }}>No headroom data available for this substation.<br />Enable the Headroom Markers layer to access real-time capacity data.</p>
    </section>
  );

  const demandUtil = sub.maxDemand && sub.transformerRating
    ? (() => {
        const rating = parseFloat(sub.transformerRating?.match(/(\d+)MVA/)?.[1]) || null;
        return rating ? Math.min(100, Math.round((sub.maxDemand / rating) * 100)) : null;
      })()
    : null;

  return (
    <>
      <section className="sidebar-section">
        <h3 className="section-title">Network Status (March 2026)</h3>
        <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
          <RAGBadge label="Demand" rag={sub.demandRAG} />
          <RAGBadge label="Generation" rag={sub.genRAG} />
        </div>
        {sub.demandConstraint && sub.demandConstraint !== 'N/A' && (
          <div className="constraint-pill" style={{ background: 'rgba(255,68,68,0.1)', border: '1px solid #FF4444' }}>
            ⚠ Demand Constraint: {sub.demandConstraint}
          </div>
        )}
        {sub.genConstraint && sub.genConstraint !== 'N/A' && (
          <div className="constraint-pill" style={{ background: 'rgba(255,149,0,0.1)', border: '1px solid #FF9500' }}>
            ⚠ Generation Constraint: {sub.genConstraint}
          </div>
        )}
      </section>

      <section className="sidebar-section">
        <h3 className="section-title">Demand</h3>
        {demandUtil != null && (
          <div className="utilisation-row">
            <span className="info-label">Peak Utilisation</span>
            <div className="utilisation-bar-wrap">
              <div className="utilisation-bar" style={{ width: `${demandUtil}%`, background: demandUtil > 85 ? '#FF4444' : demandUtil > 65 ? '#FF9500' : '#00E676' }} />
              <span className="utilisation-pct">{demandUtil}%</span>
            </div>
          </div>
        )}
        <InfoRow label="Max Observed" value={sub.maxDemand != null ? `${sub.maxDemand} MVA` : null} />
        <InfoRow label="Min Observed"  value={sub.minDemand != null ? `${sub.minDemand} MVA` : null} />
        <InfoRow label="Contracted"    value={sub.contractedDemand != null ? `${sub.contractedDemand} MVA` : null} />
        <InfoRow label="Est. Headroom" value={sub.demandHeadroom && sub.demandHeadroom !== 'N/A' ? `${sub.demandHeadroom} MVA` : null} valueColor={sub.demandHeadroom < 0 ? '#FF4444' : '#00E676'} />
        <InfoRow label="Transformer Rating" value={sanitizeRating(sub.transformerRating, sub.voltage)} />
      </section>

      <section className="sidebar-section">
        <h3 className="section-title">Generation</h3>
        <InfoRow label="Connected Gen"  value={sub.connectedGen != null ? `${sub.connectedGen} MW` : null} />
        <InfoRow label="Contracted Gen" value={sub.contractedGen != null ? `${sub.contractedGen} MW` : null} />
        <InfoRow label="Est. Headroom"  value={sub.genHeadroom && sub.genHeadroom !== 'N/A' ? `${sub.genHeadroom} MW` : null} />
      </section>

      <section className="sidebar-section">
        <h3 className="section-title">Fault Level</h3>
        <InfoRow label="3Ph Fault Level"  value={sub.faultLevel3Ph != null ? `${sub.faultLevel3Ph} kA` : null} />
        <InfoRow label="3Ph Fault Rating" value={sub.faultRating3Ph != null ? `${sub.faultRating3Ph} kA` : null} valueColor={sub.faultLevel3Ph > sub.faultRating3Ph ? '#FF4444' : null} />
      </section>

      {sub.reinforcementWorks && (
        <section className="sidebar-section">
          <h3 className="section-title">Reinforcement Works</h3>
          <p className="section-text">{sub.reinforcementWorks}</p>
          {sub.reinforcementDate && <InfoRow label="Completion" value={sub.reinforcementDate} />}
        </section>
      )}

      {sub.subComment && (
        <section className="sidebar-section">
          <h3 className="section-title">Notes</h3>
          <p className="section-text" style={{ opacity: 0.7, fontSize: '0.75rem' }}>{sub.subComment}</p>
        </section>
      )}
      <p className="data-source-label">Source: SSEN Headroom Dashboard March 2026</p>
    </>
  );
}

// ── LCT tech definitions ──────────────────────────────────────────────────
const LCT_TECHS = [
  { key: 'ev',      label: '🚗 Electric Vehicles',       color: '#4FC3F7', unit: 'count' },
  { key: 'evc',     label: '🔌 EV Charger Capacity',     color: '#81D4FA', unit: 'MW'   },
  { key: 'dhp',     label: '🔥 Domestic Heat Pumps',     color: '#FF9500', unit: 'count' },
  { key: 'ndhp',    label: '🏭 Non-Domestic Heat Pumps', color: '#FFB74D', unit: 'm²'   },
  { key: 'solar',   label: '☀️ Solar PV',               color: '#FFD700', unit: 'MW'   },
  { key: 'battery', label: '🔋 Battery Storage',         color: '#00E676', unit: 'MW'   },
];

const SCEN_META = {
  EE: { label: 'Electric Engagement', color: '#4FC3F7', dash: '0' },
  HT: { label: 'Holistic Transition',  color: '#00E676', dash: '0' },
  FB: { label: 'Falling Behind',       color: '#FF4444', dash: '4 4' },
};

const YEARS = ['Baseline', '2026', '2030', '2035', '2040', '2045', '2050'];

function LCTChart({ data, techKey, label, unit }) {
  if (!data) return null;
  const chartData = YEARS.map(y => {
    const row = { year: y === 'Baseline' ? 'Now' : y };
    Object.entries(SCEN_META).forEach(([s]) => {
      row[s] = data[techKey]?.[s]?.[y] ?? null;
    });
    return row;
  }).filter(r => Object.values(SCEN_META).some((_,i) => r[Object.keys(SCEN_META)[i]] != null));

  if (chartData.length === 0) return null;

  return (
    <div className="lct-chart-block">
      <div className="lct-chart-title">{label} <span className="lct-unit">({unit})</span></div>
      <div style={{ height: 140 }}>
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={chartData} margin={{ top: 4, right: 8, left: -18, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" />
            <XAxis dataKey="year" tick={{ fill: '#aaa', fontSize: 9 }} />
            <YAxis tick={{ fill: '#aaa', fontSize: 9 }} tickFormatter={v => v >= 1000 ? `${(v/1000).toFixed(0)}k` : v} />
            <RechartTooltip
              contentStyle={{ background: '#0d1117', border: '1px solid #333', borderRadius: 6, fontSize: 11 }}
              labelStyle={{ color: '#fff', fontWeight: 600 }}
              formatter={(v, name) => [v != null ? v.toLocaleString() : '—', SCEN_META[name]?.label]}
            />
            {Object.entries(SCEN_META).map(([s, m]) => (
              <Line key={s} type="monotone" dataKey={s} stroke={m.color}
                strokeWidth={s === 'HT' ? 2 : 1.5} strokeDasharray={m.dash}
                dot={false} connectNulls />
            ))}
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

function LCTSummaryTable({ data }) {
  if (!data) return null;
  return (
    <div className="lct-summary-table">
      <div className="lct-table-header">
        <span>Technology</span>
        <span>Now</span>
        <span>2035 (EE)</span>
        <span>2050 (HT)</span>
      </div>
      {LCT_TECHS.map(({ key, label, unit, color }) => {
        const d = data[key];
        if (!d) return null;
        const now   = d.EE?.Baseline ?? d.HT?.Baseline ?? '—';
        const y2035 = d.EE?.['2035'] ?? '—';
        const y2050 = d.HT?.['2050'] ?? '—';
        const growth = (typeof y2050 === 'number' && typeof now === 'number' && now > 0)
          ? Math.round((y2050 / now - 1) * 100) : null;
        const fmt = v => typeof v === 'number' ? v.toLocaleString() : '—';
        return (
          <div key={key} className="lct-table-row">
            <span style={{ color }}>{label} <span style={{ opacity: 0.5, fontSize: '0.7em' }}>({unit})</span></span>
            <span>{fmt(now)}</span>
            <span>{fmt(y2035)}</span>
            <span>
              {fmt(y2050)}
              {growth != null && <span className="lct-growth"> +{growth}%</span>}
            </span>
          </div>
        );
      })}
    </div>
  );
}

// ── Tab: LCT / DFES ───────────────────────────────────────────────────────
function LCTTab({ sub }) {
  const [dfes, setDfes]       = useState(null);
  const [licence, setLicence] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState(null);
  const [activeTech, setActiveTech] = useState('ev');

  const primaryKey = normPrimary(sub.name);

  useEffect(() => {
    setLoading(true);
    loadDfes()
      .then(({ byPrimary, licence: lic }) => {
        setDfes(byPrimary[primaryKey] || null);
        setLicence(lic);
      })
      .catch(e => setError(e.message))
      .finally(() => setLoading(false));
  }, [primaryKey]);

  if (loading) return <section className="sidebar-section"><p className="section-text" style={{ opacity: 0.5 }}>⏳ Loading DFES projections…</p></section>;
  if (error)   return <section className="sidebar-section"><p className="section-text" style={{ color: '#FF4444' }}>Error: {error}</p></section>;

  const activeTechMeta = LCT_TECHS.find(t => t.key === activeTech);

  return (
    <>
      {/* Primary match status */}
      <section className="sidebar-section" style={{ paddingBottom: 8 }}>
        <h3 className="section-title">LCT Projections — DFES 2025</h3>
        <div className="lct-primary-label">
          {dfes
            ? <span style={{ color: '#00E676' }}>✓ Matched: <strong>{primaryKey}</strong></span>
            : <span style={{ color: '#FF9500' }}>⚠ No DFES match for "{primaryKey}" — showing SEPD licence totals only</span>}
        </div>
      </section>

      {/* Scenario legend */}
      <section className="sidebar-section" style={{ paddingTop: 0, paddingBottom: 8 }}>
        <div className="lct-scen-legend">
          {Object.entries(SCEN_META).map(([s, m]) => (
            <div key={s} className="lct-scen-chip">
              <span style={{ display: 'inline-block', width: 16, height: 2, background: m.color, verticalAlign: 'middle', marginRight: 4 }} />
              {m.label}
            </div>
          ))}
        </div>
      </section>

      {/* Summary table */}
      {dfes && (
        <section className="sidebar-section">
          <h3 className="section-title">Summary (Primary: {primaryKey})</h3>
          <LCTSummaryTable data={dfes} />
        </section>
      )}

      {/* Tech selector + chart */}
      <section className="sidebar-section">
        <h3 className="section-title">Projection Detail</h3>
        <div className="lct-tech-tabs">
          {LCT_TECHS.map(t => (
            <button key={t.key}
              className={`lct-tech-tab ${activeTech === t.key ? 'lct-tech-tab--active' : ''}`}
              style={activeTech === t.key ? { border: `1px solid ${t.color}`, color: t.color } : {}}
              onClick={() => setActiveTech(t.key)}>
              {t.label.split(' ').slice(0, 2).join(' ')}
            </button>
          ))}
        </div>
        {dfes ? (
          <LCTChart data={dfes} techKey={activeTech} label={activeTechMeta?.label} unit={activeTechMeta?.unit} />
        ) : (
          <p className="section-text" style={{ opacity: 0.5, fontSize: '0.75rem' }}>No ESA-level data for this primary.</p>
        )}
      </section>

      {/* SEPD licence totals */}
      <section className="sidebar-section">
        <h3 className="section-title">SEPD Licence Totals (all scenarios)</h3>
        {licence && (
          <LCTChart data={licence} techKey={activeTech} label={`${activeTechMeta?.label} — SEPD total`} unit={activeTechMeta?.unit} />
        )}
        <p className="data-source-label">Source: SSEN DFES 2025 · Scenarios: Electric Engagement, Holistic Transition, Falling Behind</p>
      </section>
    </>
  );
}

// ── Tab: Data Quality ─────────────────────────────────────────────────────
function DataQualityTab({ sub, lvCountInEsa }) {
  const [dfesStatus, setDfesStatus] = useState('loading');
  const primaryKey = normPrimary(sub.name);

  useEffect(() => {
    loadDfes()
      .then(({ byPrimary }) => setDfesStatus(byPrimary[primaryKey] ? 'matched' : 'unmatched'))
      .catch(() => setDfesStatus('error'));
  }, [primaryKey]);

  const datasets = [
    {
      name: 'ESA Boundary',
      source: 'SSEN Network Maps Portal 2025',
      matched: sub.type === 'Primary' || !!sub.geometry,
      value: sub.type === 'Primary' ? '442-feature MultiPolygon shapefile' : null,
      note: 'Simplified GeoJSON — serves as spatial join anchor for all other datasets',
    },
    {
      name: 'Headroom & Capacity',
      source: 'SSEN Headroom Dashboard — March 2026',
      matched: !!(sub.demandRAG || sub.maxDemand != null),
      value: sub.demandRAG ? `Demand: ${sub.demandRAG} · Gen: ${sub.genRAG || '—'}` : null,
      note: sub.nrn ? `Joined via NRN prefix: ${sub.nrn}` : 'Join key: NRN prefix (4-digit)',
    },
    {
      name: 'NAFIRS HV Fault Records',
      source: 'SSEN NAFIRS HV SEPD',
      matched: !!(sub.faultsByYear && Object.keys(sub.faultsByYear).length > 0),
      value: sub.faultsByYear && Object.keys(sub.faultsByYear).length > 0
        ? `${Object.values(sub.faultsByYear).reduce((a, b) => a + b, 0)} faults · ${Object.keys(sub.faultsByYear).length} years`
        : null,
      note: `Joined via NRN prefix match to GeoJSON PRIMARY_NRN_SPLIT field`,
    },
    {
      name: 'DFES 2025 LCT Projections',
      source: 'SSEN Distribution Future Energy Scenarios',
      matched: dfesStatus === 'matched',
      loading: dfesStatus === 'loading',
      value: dfesStatus === 'matched' ? `Matched key: "${primaryKey}"` : null,
      note: 'Joined via normalised primary name · EV · Heat Pump · Solar · Battery (2025–2050)',
    },
    {
      name: 'LV Substations (in ESA)',
      source: 'SSEN Open Data Portal (CC BY 4.0)',
      matched: lvCountInEsa != null && lvCountInEsa > 0,
      value: lvCountInEsa != null ? `${lvCountInEsa.toLocaleString()} substations within boundary` : null,
      note: lvCountInEsa == null
        ? 'Enable the LV layer to count substations within this ESA'
        : 'Spatial join — point-in-polygon against ESA boundary geometry',
    },
  ];

  const matchedCount = datasets.filter(d => d.matched).length;
  const scoreColor = matchedCount >= 4 ? '#00E676' : matchedCount >= 3 ? '#FF9500' : '#FF4444';

  return (
    <>
      <section className="sidebar-section">
        <h3 className="section-title">Data Interoperability</h3>
        <div style={{ fontSize: 11, color: '#8899aa', marginBottom: 10 }}>
          {matchedCount} of {datasets.length} datasets linked to this {sub.type?.toLowerCase() || 'substation'}
        </div>

        {/* Score bar */}
        <div style={{ height: 6, background: 'rgba(255,255,255,0.06)', borderRadius: 3, marginBottom: 16, overflow: 'hidden' }}>
          <div style={{ height: '100%', width: `${(matchedCount / datasets.length) * 100}%`, background: scoreColor, borderRadius: 3, transition: 'width 0.4s' }} />
        </div>

        {datasets.map(d => (
          <div key={d.name} style={{
            display: 'flex', gap: 10, alignItems: 'flex-start', marginBottom: 8,
            padding: '8px 10px', borderRadius: 6,
            background: d.matched ? 'rgba(0,230,118,0.04)' : 'rgba(255,255,255,0.02)',
            border: `1px solid ${d.matched ? 'rgba(0,230,118,0.15)' : d.loading ? 'rgba(255,149,0,0.12)' : 'rgba(255,255,255,0.04)'}`,
          }}>
            <div style={{ fontSize: 13, marginTop: 1, flexShrink: 0, color: d.matched ? '#00E676' : d.loading ? '#FF9500' : '#4a6278' }}>
              {d.loading ? '⏳' : d.matched ? '✓' : '✗'}
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 11, fontWeight: 600, color: d.matched ? '#c8d8e8' : '#5a7299', marginBottom: 2 }}>
                {d.name}
              </div>
              {d.value && (
                <div style={{ fontSize: 10, color: '#00E676', marginBottom: 2 }}>{d.value}</div>
              )}
              <div style={{ fontSize: 9, color: '#3a5268' }}>{d.source}</div>
              {d.note && (
                <div style={{ fontSize: 9, color: '#4a6278', fontStyle: 'italic', marginTop: 2 }}>{d.note}</div>
              )}
            </div>
          </div>
        ))}
      </section>
      <p className="data-source-label">
        Joins: NRN prefix · name normalisation · spatial containment (point-in-polygon)
      </p>
    </>
  );
}

// ── Tab: Smart-Meter Demand Profile ───────────────────────────────────────
const TX_COLORS = ['#4FC3F7','#00E676','#FFD700','#FF9500','#FF4444',
                   '#CE93D8','#80DEEA','#A5D6A7','#FFCC02','#F48FB1',
                   '#90CAF9','#B0BEC5','#FFAB40','#69F0AE','#EF9A9A'];

function DemandChart({ timestamps, kW, height = 160, color = '#4FC3F7', label = 'Demand' }) {
  const chartData = timestamps.map((ts, i) => ({
    t: i % 4 === 0 ? ts : '',
    tFull: ts,
    MW: Math.round(kW[i] / 100) / 10,
  }));
  return (
    <ResponsiveContainer width="100%" height={height}>
      <LineChart data={chartData} margin={{ top: 4, right: 8, left: -10, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
        <XAxis dataKey="t" tick={{ fill: '#aaa', fontSize: 9 }} interval={0} />
        <YAxis tick={{ fill: '#aaa', fontSize: 9 }} tickFormatter={v => `${v}MW`} />
        <RechartTooltip
          contentStyle={{ background: '#0d1117', border: '1px solid #333', borderRadius: 6, fontSize: 11 }}
          formatter={v => [`${v} MW`, label]}
          labelFormatter={(_, p) => p?.[0]?.payload?.tFull ?? ''}
        />
        <Line type="monotone" dataKey="MW" stroke={color} strokeWidth={2} dot={false} />
      </LineChart>
    </ResponsiveContainer>
  );
}

function DemandTab({ sub, primaryNrn }) {
  // Works for primary subs (sub.nrn) or LV subs shown in context of a primary (primaryNrn prop)
  const nrn = sub?.nrn || primaryNrn;
  const isLV = !sub?.nrn && !!primaryNrn;

  const [profiles, setProfiles] = useState(null);
  const [entry, setEntry]       = useState(null);
  const [showTx, setShowTx]     = useState(false);
  const [loading, setLoading]   = useState(true);
  const [error, setError]       = useState(null);

  useEffect(() => {
    if (!nrn) { setLoading(false); return; }
    setLoading(true); setError(null); setEntry(null); setShowTx(false);
    loadDemandProfiles()
      .then(p => {
        setProfiles(p);
        const key = nrn.padStart(4, '0');
        const d = p.primaries[key] || p.primaries[nrn];
        if (!d) setError(`No demand data for NRN ${nrn} (24 Mar 2026)`);
        else setEntry(d);
      })
      .catch(e => setError(e.message))
      .finally(() => setLoading(false));
  }, [nrn]);

  if (loading) return <section className="sidebar-section"><p className="section-text" style={{ opacity: 0.5 }}>⏳ Loading demand profile…</p></section>;
  if (error)   return <section className="sidebar-section"><p className="section-text" style={{ color: '#FF9500' }}>⚠ {error}</p></section>;
  if (!nrn)    return <section className="sidebar-section"><p className="section-text" style={{ opacity: 0.5 }}>No NRN available — demand data requires a primary substation.</p></section>;
  if (!entry)  return null;

  const { kW, meters, transformers } = entry;
  const ts = profiles.timestamps;

  const peakMW = Math.max(...kW) / 1000;
  const minMW  = Math.min(...kW) / 1000;
  const avgMW  = (kW.reduce((a,b)=>a+b,0) / kW.length) / 1000;

  // Transformer chart — ranked by peak, top 15, using substation names
  const rankedTx = Object.entries(transformers)
    .map(([id, t]) => ({ id, name: t.name, peak: Math.max(...t.kW) }))
    .sort((a,b) => b.peak - a.peak)
    .slice(0, 15);

  const txChartData = ts.map((t, i) => {
    const row = { t: i % 4 === 0 ? t : '', tFull: t };
    rankedTx.forEach(({ id, name }) => { row[name] = transformers[id].kW[i] / 1000; });
    return row;
  });

  return (
    <>
      <section className="sidebar-section">
        <h3 className="section-title">Demand Profile — 24 Mar 2026{isLV ? ' (Primary ESA)' : ''}</h3>
        <p style={{ fontSize: 10, color: '#3a5268', marginBottom: 8 }}>
          DCC Smart Meter · NRN {nrn} · ~{meters.toLocaleString()} avg active meters
        </p>

        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 12 }}>
          {[
            { label: 'Peak',        val: `${peakMW.toFixed(1)} MW` },
            { label: 'Min',         val: `${minMW.toFixed(1)} MW`  },
            { label: 'Avg',         val: `${avgMW.toFixed(1)} MW`  },
            { label: 'Load Factor', val: `${peakMW > 0 ? ((avgMW/peakMW)*100).toFixed(0) : '—'}%` },
          ].map(({ label, val }) => (
            <div key={label} style={{ flex:'1 1 70px', background:'#0a1929', borderRadius:6, padding:'6px 8px', textAlign:'center' }}>
              <div style={{ fontSize:9, color:'#3a5268', textTransform:'uppercase', marginBottom:2 }}>{label}</div>
              <div style={{ fontSize:13, color:'#4FC3F7', fontWeight:600 }}>{val}</div>
            </div>
          ))}
        </div>

        <DemandChart timestamps={ts} kW={kW} height={160} />
      </section>

      {/* Secondary transformer breakdown */}
      <section className="sidebar-section" style={{ paddingTop: 0 }}>
        <button onClick={() => setShowTx(v => !v)}
          style={{ fontSize:11, color:'#4FC3F7', background:'transparent', border:'1px solid #1a3a5c',
            borderRadius:4, padding:'4px 10px', cursor:'pointer', marginBottom:8 }}>
          {showTx ? '▲ Hide secondary transformer breakdown' : `▼ Show secondary transformer breakdown (${rankedTx.length})`}
        </button>

        {showTx && (
          <>
            <ResponsiveContainer width="100%" height={200}>
              <LineChart data={txChartData} margin={{ top:4, right:8, left:-10, bottom:0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
                <XAxis dataKey="t" tick={{ fill:'#aaa', fontSize:9 }} interval={0} />
                <YAxis tick={{ fill:'#aaa', fontSize:9 }} tickFormatter={v=>`${v.toFixed(1)}MW`} />
                <RechartTooltip
                  contentStyle={{ background:'#0d1117', border:'1px solid #333', borderRadius:6, fontSize:10 }}
                  formatter={(v, name) => [`${(+v).toFixed(2)} MW`, name]}
                  labelFormatter={(_, p) => p?.[0]?.payload?.tFull ?? ''}
                />
                {rankedTx.map(({ name }, i) => (
                  <Line key={name} type="monotone" dataKey={name}
                    stroke={TX_COLORS[i % TX_COLORS.length]} strokeWidth={1.5} dot={false} connectNulls />
                ))}
              </LineChart>
            </ResponsiveContainer>
            {/* Transformer name legend */}
            <div style={{ marginTop:6 }}>
              {rankedTx.map(({ name, peak }, i) => (
                <div key={name} style={{ display:'flex', alignItems:'center', gap:6, fontSize:9, marginBottom:2 }}>
                  <span style={{ display:'inline-block', width:12, height:2, background:TX_COLORS[i%TX_COLORS.length] }} />
                  <span style={{ color:'#ccc', flex:1 }}>{name}</span>
                  <span style={{ color:'#3a5268' }}>peak {(peak/1000).toFixed(2)} MW</span>
                </div>
              ))}
            </div>
            <p style={{ fontSize:9, color:'#3a5268', marginTop:6 }}>Secondary substations (SSE ID) — top {rankedTx.length} by peak demand</p>
          </>
        )}
      </section>
    </>
  );
}

// ── Main Sidebar ──────────────────────────────────────────────────────────
const TABS = ['Details', 'Headroom', 'LCT', 'Demand', 'Quality'];

export default function SubstationSidebar({ substation, onClose, onAskChatbot, lvCountInEsa }) {
  const [activeTab, setActiveTab] = useState('Details');

  if (!substation) return null;

  const voltageColor = getVoltageColor(substation.voltage);
  const statusColor  = getStatusColor(substation.status);

  return (
    <div className="sidebar">
      {/* Header */}
      <div className="sidebar-header">
        <div className="sidebar-header-top">
          <div className="sidebar-type-badge" style={{ background: voltageColor + '22', color: voltageColor, border: `1px solid ${voltageColor}` }}>
            {substation.type} · {substation.voltage}
          </div>
          <button className="close-btn" onClick={onClose} aria-label="Close">✕</button>
        </div>
        <h2 className="sidebar-title">{substation.name}</h2>
        <div className="sidebar-meta-line">
          <span className="sidebar-operator">{substation.operator}</span>
          <span className="meta-sep">·</span>
          <span className="sidebar-status" style={{ color: statusColor }}>
            <span className="status-dot" style={{ background: statusColor }} />
            {substation.status}
          </span>
        </div>
      </div>

      {/* Tabs */}
      <div className="sidebar-tabs">
        {TABS.map(tab => (
          <button key={tab} className={`sidebar-tab ${activeTab === tab ? 'sidebar-tab--active' : ''}`} onClick={() => setActiveTab(tab)}>
            {tab}
            {tab === 'Faults' && substation.faultsByYear && Object.keys(substation.faultsByYear).length > 0 && (
              <span className="tab-badge">{Object.values(substation.faultsByYear).reduce((a, b) => a + b, 0)}</span>
            )}
          </button>
        ))}
      </div>

      {/* Tab Content */}
      <div className="sidebar-body">
        {activeTab === 'Details'  && <DetailsTab      sub={substation} voltageColor={voltageColor} statusColor={statusColor} onAskChatbot={onAskChatbot} />}
        {activeTab === 'Headroom' && <HeadroomTab     sub={substation} />}
        {activeTab === 'LCT'      && <LCTTab          sub={substation} />}
        {activeTab === 'Demand'   && <DemandTab        sub={substation} />}
        {activeTab === 'Quality'  && <DataQualityTab  sub={substation} lvCountInEsa={lvCountInEsa} />}
      </div>
    </div>
  );
}
