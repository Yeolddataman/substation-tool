import { useState, useRef, useEffect } from 'react';
import { MapContainer, TileLayer, CircleMarker } from 'react-leaflet';
import {
  BarChart, Bar, LineChart, Line,
  XAxis, YAxis, CartesianGrid, Tooltip as RechartTooltip,
  ResponsiveContainer, Cell, Legend as RechartLegend,
} from 'recharts';
import 'leaflet/dist/leaflet.css';
import { getVoltageColor, getStatusColor } from '../data/substations';

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
    <div className="rag-badge" style={{ background: ragBg(rag), borderColor: ragColor(rag) }}>
      <span className="rag-dot" style={{ background: ragColor(rag) }} />
      <span className="rag-label">{label}</span>
      <span className="rag-value" style={{ color: ragColor(rag) }}>{rag}</span>
    </div>
  );
}

// ── Tab: Details ──────────────────────────────────────────────────────────
function DetailsTab({ sub, voltageColor, statusColor, onAskChatbot, images, setImages }) {
  const [dragOver, setDragOver] = useState(false);
  const fileInputRef = useRef(null);

  const handleFiles = (files) => {
    Array.from(files).forEach((file) => {
      if (!file.type.startsWith('image/')) return;
      const reader = new FileReader();
      reader.onload = (e) => setImages(prev => [...prev, { id: Date.now() + Math.random(), url: e.target.result, name: file.name }]);
      reader.readAsDataURL(file);
    });
  };

  return (
    <>
      <section className="sidebar-section" style={{ paddingBottom: 0 }}>
        <h3 className="section-title">Satellite View</h3>
        <SatelliteMiniMap lat={sub.lat} lng={sub.lng} voltageColor={voltageColor} />
      </section>

      <section className="sidebar-section">
        <h3 className="section-title">Asset Details</h3>
        <InfoRow label="Type"         value={sub.type} />
        <InfoRow label="Voltage"      value={sub.voltage ? `${sub.voltage} kV` : sub.voltage} />
        <InfoRow label="Grid Ref"     value={sub.gridRef} />
        <InfoRow label="Region"       value={sub.region} />
        <InfoRow label="Year Installed" value={sub.yearInstalled} />
        <InfoRow label="Last Inspection" value={sub.lastInspection} />
        <InfoRow label="Transformer"  value={sub.transformerRating} />
        <InfoRow label="Upstream GSP" value={sub.upstreamGSP} />
        <InfoRow label="Upstream BSP" value={sub.upstreamBSP} />
        <InfoRow label="Coordinates"  value={`${sub.lat?.toFixed(4)}°N, ${Math.abs(sub.lng)?.toFixed(4)}°${sub.lng < 0 ? 'W' : 'E'}`} />
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

      <section className="sidebar-section">
        <h3 className="section-title">Site Photos</h3>
        <div className={`drop-zone ${dragOver ? 'drop-zone--active' : ''}`}
          onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
          onDragLeave={() => setDragOver(false)}
          onDrop={(e) => { e.preventDefault(); setDragOver(false); handleFiles(e.dataTransfer.files); }}
          onClick={() => fileInputRef.current?.click()}>
          <div className="drop-icon">📷</div>
          <div className="drop-text">Drop images here or click to upload</div>
          <div className="drop-subtext">JPEG, PNG, WebP · Max 10MB</div>
        </div>
        <input ref={fileInputRef} type="file" accept="image/*" multiple style={{ display: 'none' }} onChange={(e) => handleFiles(e.target.files)} />
        {images.length > 0 && (
          <div className="image-gallery">
            {images.map((img) => (
              <div key={img.id} className="image-card">
                <img src={img.url} alt={img.name} className="image-thumb" />
                <div className="image-actions">
                  <button className="btn btn-sm btn-primary" onClick={() => onAskChatbot(`Analyse this image of equipment at ${sub.name} substation (${sub.voltage}, operated by ${sub.operator}). Identify any visible safety hazards, equipment type, and relevant UK safety standards that apply.`, img)}>🔍 Analyse</button>
                  <button className="btn btn-sm btn-danger" onClick={() => setImages(prev => prev.filter(i => i.id !== img.id))}>✕</button>
                </div>
                <div className="image-name">{img.name}</div>
              </div>
            ))}
          </div>
        )}
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
          <div className="constraint-pill" style={{ background: 'rgba(255,68,68,0.1)', borderColor: '#FF4444' }}>
            ⚠ Demand Constraint: {sub.demandConstraint}
          </div>
        )}
        {sub.genConstraint && sub.genConstraint !== 'N/A' && (
          <div className="constraint-pill" style={{ background: 'rgba(255,149,0,0.1)', borderColor: '#FF9500' }}>
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
        <InfoRow label="Transformer Rating" value={sub.transformerRating} />
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

// ── Tab: Faults ───────────────────────────────────────────────────────────
function FaultsTab({ sub }) {
  const faults = sub.faultsByYear || {};
  const years  = Object.keys(faults).sort();

  if (years.length === 0) return (
    <section className="sidebar-section">
      <p className="section-text" style={{ opacity: 0.5 }}>No NAFIRS HV fault records found for this substation (NRN: {sub.nrn || 'unmatched'}).</p>
    </section>
  );

  const chartData = years.map(y => ({ year: y, faults: faults[y] }));
  const total = Object.values(faults).reduce((a, b) => a + b, 0);
  const avg   = Math.round(total / years.length * 10) / 10;
  const peak  = Math.max(...Object.values(faults));
  const peakYear = years.find(y => faults[y] === peak);

  return (
    <>
      <section className="sidebar-section">
        <h3 className="section-title">HV Fault History (NAFIRS)</h3>
        <div style={{ display: 'flex', gap: 16, marginBottom: 12 }}>
          <div className="fault-stat"><span className="fault-stat-value">{total}</span><span className="fault-stat-label">Total Faults</span></div>
          <div className="fault-stat"><span className="fault-stat-value">{avg}</span><span className="fault-stat-label">Avg / Year</span></div>
          <div className="fault-stat"><span className="fault-stat-value">{peak}</span><span className="fault-stat-label">Peak ({peakYear})</span></div>
          <div className="fault-stat"><span className="fault-stat-value">{sub.feederCount || '—'}</span><span className="fault-stat-label">Feeders</span></div>
        </div>
        <div style={{ height: 180 }}>
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={chartData} margin={{ top: 4, right: 4, left: -20, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.08)" />
              <XAxis dataKey="year" tick={{ fill: '#aaa', fontSize: 10 }} />
              <YAxis tick={{ fill: '#aaa', fontSize: 10 }} />
              <RechartTooltip contentStyle={{ background: '#0d1117', border: '1px solid #333', borderRadius: 6, fontSize: 12 }} labelStyle={{ color: '#fff' }} itemStyle={{ color: '#FFD700' }} formatter={(v) => [`${v} faults`, 'Count']} />
              <Bar dataKey="faults" radius={[3, 3, 0, 0]}>
                {chartData.map((entry, i) => (
                  <Cell key={i} fill={entry.faults === peak ? '#FF9500' : '#4FC3F7'} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
        <p className="data-source-label">Source: SSEN NAFIRS HV SEPD 2024 · NRN prefix: {sub.nrn}</p>
      </section>
    </>
  );
}

// ── LCT tech definitions ──────────────────────────────────────────────────
const LCT_TECHS = [
  { key: 'ev',      label: '🚗 Electric Vehicles',   color: '#4FC3F7', unit: 'vehicles' },
  { key: 'evc',     label: '🔌 EV Chargers',          color: '#81D4FA', unit: 'chargers' },
  { key: 'dhp',     label: '🔥 Domestic Heat Pumps',  color: '#FF9500', unit: 'units'    },
  { key: 'ndhp',    label: '🏭 Non-Domestic HPs',     color: '#FFB74D', unit: 'units'    },
  { key: 'solar',   label: '☀️ Solar PV',             color: '#FFD700', unit: 'MW'       },
  { key: 'battery', label: '🔋 Battery Storage',      color: '#00E676', unit: 'MW'       },
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
      {LCT_TECHS.map(({ key, label, unit }) => {
        const d = data[key];
        if (!d) return null;
        const now   = d.EE?.Baseline ?? d.HT?.Baseline ?? '—';
        const y2035 = d.EE?.['2035'] ?? '—';
        const y2050 = d.HT?.['2050'] ?? '—';
        const growth = (typeof y2050 === 'number' && typeof now === 'number' && now > 0)
          ? Math.round((y2050 / now - 1) * 100) : null;
        return (
          <div key={key} className="lct-table-row">
            <span style={{ color: LCT_TECHS.find(t=>t.key===key)?.color }}>{label}</span>
            <span>{typeof now === 'number' ? now.toLocaleString() : '—'}</span>
            <span>{typeof y2035 === 'number' ? y2035.toLocaleString() : '—'}</span>
            <span>
              {typeof y2050 === 'number' ? y2050.toLocaleString() : '—'}
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
              style={activeTech === t.key ? { borderColor: t.color, color: t.color } : {}}
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

// ── Main Sidebar ──────────────────────────────────────────────────────────
const TABS = ['Details', 'Headroom', 'Faults', 'LCT'];

export default function SubstationSidebar({ substation, onClose, onAskChatbot }) {
  const [images, setImages] = useState([]);
  const [activeTab, setActiveTab] = useState('Details');

  if (!substation) return null;

  const voltageColor = getVoltageColor(substation.voltage);
  const statusColor  = getStatusColor(substation.status);

  return (
    <div className="sidebar">
      {/* Header */}
      <div className="sidebar-header">
        <div className="sidebar-header-top">
          <div className="sidebar-type-badge" style={{ background: voltageColor + '22', color: voltageColor, borderColor: voltageColor }}>
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
        {activeTab === 'Details'  && <DetailsTab  sub={substation} voltageColor={voltageColor} statusColor={statusColor} onAskChatbot={onAskChatbot} images={images} setImages={setImages} />}
        {activeTab === 'Headroom' && <HeadroomTab sub={substation} />}
        {activeTab === 'Faults'   && <FaultsTab   sub={substation} />}
        {activeTab === 'LCT'      && <LCTTab      sub={substation} />}
      </div>
    </div>
  );
}
