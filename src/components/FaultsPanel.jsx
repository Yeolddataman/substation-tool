import { useState, useEffect, useRef, useCallback } from 'react';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid,
  Tooltip as RechartTooltip, ResponsiveContainer, Cell,
} from 'recharts';
import { FaultTimeline } from './OutagePanel';
import { fetchForecast } from '../lib/forecast';

const OUTAGES_URL  = 'https://raw.githubusercontent.com/robintw/sse_powercuts/master/outages.json';
const SEPD_NETWORK = 'com.sse.ssepd.sepd';
const TYPE_COLOR   = { HV: '#FF9500', LV: '#FFD700', PSI: '#c084fc' };
const typeColor    = t => TYPE_COLOR[t] || '#aaa';

const FC_COLOR = { Red: '#FF4444', Yellow: '#FFD700', Green: '#00E676' };
const FC_BG    = { Red: 'rgba(255,68,68,0.12)', Yellow: 'rgba(255,215,0,0.12)', Green: 'rgba(0,230,118,0.12)' };
const FC_ICON  = { Red: '🔴', Yellow: '🟡', Green: '🟢' };

function fmtDT(iso) {
  if (!iso) return '—';
  try { return new Date(iso).toLocaleString('en-GB', { day:'2-digit', month:'short', hour:'2-digit', minute:'2-digit' }); }
  catch { return iso; }
}
function elapsed(iso) {
  if (!iso) return '—';
  try {
    const ms = Date.now() - new Date(iso).getTime();
    if (ms < 0) return 'Just logged';
    const h = Math.floor(ms / 3600000), m = Math.floor((ms % 3600000) / 60000);
    return h > 0 ? `${h}h ${m}m` : `${m}m`;
  } catch { return '—'; }
}

function NafirsHistory({ sub }) {
  const faults = sub.faultsByYear || {};
  const years  = Object.keys(faults).sort();
  const chartData = years.map(y => ({ year: y, faults: faults[y] }));
  const total  = Object.values(faults).reduce((a, b) => a + b, 0);
  const avg    = Math.round(total / years.length * 10) / 10;
  const peak   = Math.max(...Object.values(faults));
  const peakYr = years.find(y => faults[y] === peak);
  return (
    <div>
      <p style={{ fontSize: 11, fontWeight: 700, color: '#8899aa', marginBottom: 10 }}>{sub.name}</p>
      <div style={{ display: 'flex', gap: 12, marginBottom: 12 }}>
        {[['Total', total], ['Avg/yr', avg], [`Peak (${peakYr})`, peak], ['Feeders', sub.feederCount || '—']].map(([l, v]) => (
          <div key={l} className="fault-stat">
            <span className="fault-stat-value">{v}</span>
            <span className="fault-stat-label">{l}</span>
          </div>
        ))}
      </div>
      <div style={{ height: 180 }}>
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={chartData} margin={{ top: 4, right: 4, left: -20, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.08)" />
            <XAxis dataKey="year" tick={{ fill: '#aaa', fontSize: 10 }} />
            <YAxis tick={{ fill: '#aaa', fontSize: 10 }} />
            <RechartTooltip contentStyle={{ background: '#0d1117', border: '1px solid #333', borderRadius: 6, fontSize: 12 }} labelStyle={{ color: '#fff' }} itemStyle={{ color: '#FFD700' }} formatter={v => [`${v} faults`, 'Count']} />
            <Bar dataKey="faults" radius={[3, 3, 0, 0]}>
              {chartData.map((e, i) => <Cell key={i} fill={e.faults === peak ? '#FF9500' : '#4FC3F7'} />)}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
      <p style={{ fontSize: 9, color: '#3a5268', marginTop: 4 }}>Source: SSEN NAFIRS HV SEPD 2024 · NRN: {sub.nrn}</p>
    </div>
  );
}

function ForecastContent({ forecastData, forecastDay, onDayChange, forecastOverlayActive, onOverlayToggle, selectedSubstation, loading, error }) {
  const nrn     = selectedSubstation?.nrn;
  const primary = forecastData?.primaries?.[nrn];
  const ragCounts = forecastData?.primaries ? (() => {
    const c = { Red: 0, Yellow: 0, Green: 0 };
    Object.values(forecastData.primaries).forEach(p => { const r = p.days[forecastDay ?? 0]?.rag; if (r) c[r]++; });
    return c;
  })() : null;
  return (
    <div>
      {loading && <p style={{ fontSize: 11, color: '#6a8099' }}>Fetching weather forecast…</p>}
      {error   && <p style={{ fontSize: 11, color: '#FF4444' }}>⚠ {error}</p>}
      {forecastData && (<>
        <div style={{ display: 'flex', gap: 4, marginBottom: 10 }}>
          {forecastData.days.map((d, i) => (
            <button key={i} className={`forecast-day-btn${forecastDay === i ? ' forecast-day-btn--active' : ''}`} onClick={() => onDayChange?.(i)}>{d.label}</button>
          ))}
        </div>
        {ragCounts && (
          <div style={{ display:'flex', alignItems:'center', gap:10, marginBottom:10, padding:'8px 10px', background:'rgba(255,255,255,0.03)', borderRadius:6 }}>
            {['Red','Yellow','Green'].map(r => <span key={r} style={{ color: FC_COLOR[r], fontWeight:700, fontSize:13 }}>{FC_ICON[r]} {ragCounts[r]}</span>)}
            <span style={{ fontSize:9, color:'#3a5268', flex:1, textAlign:'right' }}>primaries · {forecastData.days[forecastDay]?.label}</span>
          </div>
        )}
        <button className={`faults-ctrl-btn${forecastOverlayActive ? ' faults-ctrl-btn--active' : ''}`} style={{ marginBottom: 14, width: '100%' }} onClick={() => onOverlayToggle?.(!forecastOverlayActive)}>
          {forecastOverlayActive ? '🗺 Forecast Overlay ON' : '🗺 Show Overlay on Map'}
        </button>
        {primary ? (<>
          <p style={{ fontSize: 11, fontWeight: 700, color: '#8899aa', marginBottom: 8 }}>{selectedSubstation.name} — site forecast</p>
          <div style={{ display:'flex', gap:6, marginBottom:10 }}>
            {forecastData.days.map((d, i) => {
              const day = primary.days[i]; const rag = day?.rag || 'Green';
              return (
                <div key={i} style={{ flex:1, borderRadius:6, padding:'8px 6px', textAlign:'center', background:FC_BG[rag], border:`1px solid ${FC_COLOR[rag]}44` }}>
                  <div style={{ fontSize:9, color:'#6a8099', marginBottom:3 }}>{d.label}</div>
                  <div style={{ fontSize:20, lineHeight:1 }}>{FC_ICON[rag]}</div>
                  <div style={{ fontSize:10, fontWeight:700, color:FC_COLOR[rag], marginTop:3 }}>{rag}</div>
                  <div style={{ fontSize:9, color:'#4a6070', marginTop:4 }}>
                    💨 {day.gust} km/h{day.rain > 0 && <><br />🌧 {day.rain} mm</>}{day.snow > 0 && <><br />❄ {day.snow} cm</>}<br />🌡 {day.tmax}°C
                  </div>
                </div>
              );
            })}
          </div>
          <p style={{ fontSize:10, color:'#6a8099', marginBottom:6 }}>
            Vulnerability: {primary.vuln <= 0.7 ? 'Low' : primary.vuln <= 1.0 ? 'Below avg' : primary.vuln <= 1.2 ? 'Above avg' : 'High'} ({primary.vuln}×)
          </p>
        </>) : (
          <p style={{ fontSize:11, color:'#6a8099', marginBottom:10 }}>
            {nrn ? `No forecast model data for NRN ${nrn}.` : 'Select a primary substation to view site-specific forecast.'}
          </p>
        )}
        <p style={{ fontSize:9, color:'#2e4460', borderTop:'1px solid rgba(255,255,255,0.04)', paddingTop:6 }}>
          Weather: Open-Meteo · Risk: wind (55%), rain (25%), snow (20%) · Calibrated to NAFIRS<br />
          Generated: {new Date(forecastData.generatedAt).toLocaleTimeString('en-GB', { hour:'2-digit', minute:'2-digit' })}
        </p>
      </>)}
    </div>
  );
}

const TABS = ['Live', 'CML', 'History', 'Forecast'];

export default function FaultsPanel({
  isOpen, onClose, selectedSubstation,
  onOutagesChange, onShowOnMapChange, showFaultsOnMap, onLocate,
  forecastData, forecastDay, onForecastLoaded, onForecastDayChange,
  onForecastOverlayChange, forecastOverlayActive,
}) {
  const [activeTab, setActiveTab]     = useState('Live');
  const [outages, setOutages]         = useState([]);
  const [lastUpdated, setLastUpdated] = useState(null);
  const [loading, setLoading]         = useState(false);
  const [error, setError]             = useState(null);
  const [autoRefresh, setAutoRefresh] = useState(false);
  const [locating, setLocating]       = useState(null);
  const [fcLoading, setFcLoading]     = useState(false);
  const [fcError, setFcError]         = useState(null);
  const intervalRef = useRef(null);

  const fetchOutages = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const res  = await fetch(`${OUTAGES_URL}?t=${Date.now()}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      const sepd = (data.Faults || []).filter(f => f.networkId === SEPD_NETWORK && f.resolved === false);
      setOutages(sepd); setLastUpdated(new Date()); onOutagesChange?.(sepd);
    } catch (e) { setError(e.message); }
    finally { setLoading(false); }
  }, [onOutagesChange]);

  useEffect(() => { if (isOpen) fetchOutages(); }, [isOpen, fetchOutages]);
  useEffect(() => {
    clearInterval(intervalRef.current);
    if (autoRefresh && isOpen) intervalRef.current = setInterval(fetchOutages, 60000);
    return () => clearInterval(intervalRef.current);
  }, [autoRefresh, isOpen, fetchOutages]);
  useEffect(() => {
    if (activeTab !== 'Forecast' || forecastData) return;
    setFcLoading(true); setFcError(null);
    fetchForecast()
      .then(d => { onForecastLoaded?.(d); setFcLoading(false); })
      .catch(e => { setFcError(e.message); setFcLoading(false); });
  }, [activeTab, forecastData, onForecastLoaded]);

  const handleLocate = useCallback(o => {
    if (o.latitude == null) return;
    onLocate?.(o.latitude, o.longitude);
    setLocating(o.UUID);
    setTimeout(() => setLocating(null), 2000);
  }, [onLocate]);

  if (!isOpen) return null;

  const hvFaults = outages.filter(o => o.type === 'HV');
  const lvFaults = outages.filter(o => o.type === 'LV');
  const total    = outages.length;
  const totalCustomers = outages.reduce((s, o) => s + (o.affectedCustomerCount || 0), 0);

  return (
    <div className="faults-panel">
      <div className="faults-panel-header">
        <div>
          <div className="faults-panel-title">⚡ Faults &amp; Risk</div>
          <div className="faults-panel-subtitle">
            {total > 0 ? `${total} active fault${total > 1 ? 's' : ''} · ${totalCustomers.toLocaleString()} customers` : 'No active faults · SEPD'}
          </div>
        </div>
        <button className="close-btn" onClick={onClose}>✕</button>
      </div>
      <div className="faults-panel-tabs">
        {TABS.map(t => (
          <button key={t} className={`faults-panel-tab${activeTab === t ? ' faults-panel-tab--active' : ''}`} onClick={() => setActiveTab(t)}>
            {t}{t === 'Live' && total > 0 && <span className="tab-badge">{total}</span>}
          </button>
        ))}
      </div>
      <div className="faults-panel-body">
        {activeTab === 'Live' && (<>
          <div className="faults-live-controls">
            <button className="faults-ctrl-btn" onClick={fetchOutages}>{loading ? '⏳' : '↺'} Refresh</button>
            <button className={`faults-ctrl-btn${autoRefresh ? ' faults-ctrl-btn--active' : ''}`} onClick={() => setAutoRefresh(v => !v)}>{autoRefresh ? '🟢 Auto' : '⏸ Auto'}</button>
            <button className={`faults-ctrl-btn${showFaultsOnMap ? ' faults-ctrl-btn--active' : ''}`} onClick={() => onShowOnMapChange?.(!showFaultsOnMap)}>🗺 {showFaultsOnMap ? 'On Map' : 'Map Off'}</button>
            {lastUpdated && <span className="faults-updated">{lastUpdated.toLocaleTimeString('en-GB', { hour:'2-digit', minute:'2-digit' })}</span>}
          </div>
          {total > 0 && (
            <div className="faults-badge-row">
              {hvFaults.length > 0 && <span className="outage-badge outage-badge--hv">HV {hvFaults.length}</span>}
              {lvFaults.length > 0 && <span className="outage-badge outage-badge--lv">LV {lvFaults.length}</span>}
              {totalCustomers > 0 && <span className="outage-badge outage-badge--customers">👥 {totalCustomers.toLocaleString()}</span>}
              <span style={{ fontSize:9, color:'#3a5268', marginLeft:4 }}>📍 Click to fly to fault</span>
            </div>
          )}
          {error && <div className="outage-error">⚠ {error}</div>}
          {outages.map(o => {
            const color = typeColor(o.type); const isLoc = locating === o.UUID;
            const cml = o.estimatedRestoration ? Math.round((o.affectedCustomerCount || 0) * Math.max(0, (new Date(o.estimatedRestoration) - Date.now()) / 60000)) : 0;
            return (
              <div key={o.UUID} className={`outage-item outage-item--active outage-item--locatable${isLoc ? ' outage-item--locating' : ''}`} onClick={() => handleLocate(o)}>
                <div className="outage-item-top">
                  <span className="outage-job">{o.reference}</span>
                  <span className="outage-type" style={{ color }}>{o.type}</span>
                  {o.networkType && <span style={{ fontSize:10, color:'#666', textTransform:'capitalize' }}>{o.networkType}</span>}
                  <span className="outage-pin">{isLoc ? '✈' : '📍'}</span>
                  <span className="outage-elapsed">⏱ {elapsed(o.loggedAt)}</span>
                  <div style={{ width:88, flexShrink:0, fontSize:9, color:'#6a8099', textAlign:'right', whiteSpace:'nowrap' }}>
                    {cml > 0 ? `${cml.toLocaleString()} CML` : '—'}
                    {o.estimatedRestoration && <div style={{ fontSize:8, color:'#3a5268', marginTop:1 }}>ETR {new Date(o.estimatedRestoration).toLocaleDateString('en-GB', { day:'numeric', month:'short' })}</div>}
                  </div>
                </div>
                <div className="outage-fault-name">{o.name}</div>
                {o.affectedCustomerCount > 0 && <div className="outage-customers">👥 {o.affectedCustomerCount.toLocaleString()} customers affected</div>}
                <div className="outage-item-bottom">
                  <span>Logged: {fmtDT(o.loggedAt)}</span>
                  {o.estimatedRestoration && <span>ETR: {fmtDT(o.estimatedRestoration)}</span>}
                </div>
                {o.estimatedArrivalOnSiteTime && <div className="outage-eta">🚐 Engineer ETA: {fmtDT(o.estimatedArrivalOnSiteTime)}</div>}
              </div>
            );
          })}
          {!error && total === 0 && !loading && <div className="outage-empty">No active faults for SEPD South England.</div>}
          <div className="outage-source">
            Source: robintw/sse_powercuts · {lastUpdated ? `Updated ${lastUpdated.toLocaleTimeString('en-GB')}` : 'Loading…'}{autoRefresh && ' · Auto-refresh ON'}
          </div>
        </>)}
        {activeTab === 'CML' && (total > 0 ? <FaultTimeline outages={outages} /> : <p style={{ fontSize:11, color:'#6a8099', paddingTop:8 }}>No active faults with ETR data.</p>)}
        {activeTab === 'History' && (
          selectedSubstation?.faultsByYear && Object.keys(selectedSubstation.faultsByYear).length > 0
            ? <NafirsHistory sub={selectedSubstation} />
            : <p style={{ fontSize:11, color:'#6a8099', paddingTop:8 }}>{selectedSubstation ? `No NAFIRS data for ${selectedSubstation.name} (NRN: ${selectedSubstation.nrn || 'unmatched'}).` : 'Select a primary substation on the map to view NAFIRS fault history.'}</p>
        )}
        {activeTab === 'Forecast' && (
          <ForecastContent forecastData={forecastData} forecastDay={forecastDay} onDayChange={onForecastDayChange} forecastOverlayActive={forecastOverlayActive} onOverlayToggle={onForecastOverlayChange} selectedSubstation={selectedSubstation} loading={fcLoading} error={fcError} />
        )}
      </div>
    </div>
  );
}
