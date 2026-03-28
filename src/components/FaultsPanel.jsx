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

const kphToMph = v => Math.round(v * 0.6214);

function computeNetworkWeather(primaries, numDays) {
  const acc = Array.from({ length: numDays }, () => ({ gust: [], rain: [], snow: [], tmax: [], rags: {} }));
  Object.values(primaries).forEach(p => {
    p.days.forEach((d, i) => {
      if (!acc[i]) return;
      acc[i].gust.push(d.gust); acc[i].rain.push(d.rain);
      acc[i].snow.push(d.snow ?? 0); acc[i].tmax.push(d.tmax);
      if (d.rag) acc[i].rags[d.rag] = (acc[i].rags[d.rag] || 0) + 1;
    });
  });
  return acc.map(d => {
    const mean = arr => arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : 0;
    const rag  = Object.entries(d.rags).sort((a, b) => b[1] - a[1])[0]?.[0] || 'Green';
    return {
      gust: Math.round(mean(d.gust)), rain: Math.round(mean(d.rain) * 10) / 10,
      snow: Math.round(mean(d.snow) * 10) / 10, tmax: Math.round(mean(d.tmax) * 10) / 10, rag,
    };
  });
}

function WeatherCards({ days, weatherDays }) {
  const maxGust = Math.max(...weatherDays.map(d => d.gust), 1);
  const maxRain = Math.max(...weatherDays.map(d => d.rain), 0.5);
  const maxSnow = Math.max(...weatherDays.map(d => d.snow ?? 0), 0.5);
  const hasSnow = weatherDays.some(d => (d.snow ?? 0) > 0.1);

  const gustColor = g => g < 40 ? '#4FC3F7' : g < 70 ? '#FFD700' : '#FF4444';
  const tempColor = t => t > 25 ? '#f08030' : t > 18 ? '#f5c842' : t > 10 ? '#7ec8a0' : t > 2 ? '#7ab5cf' : '#a8d4e8';

  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 6, marginBottom: 10 }}>
      {weatherDays.map((day, i) => {
        const rag = day.rag || 'Green';
        const mph = kphToMph(day.gust);
        const gc  = gustColor(day.gust);
        const tc  = tempColor(day.tmax);
        return (
          <div key={i} style={{ background: FC_BG[rag], border: `1px solid ${FC_COLOR[rag]}44`, borderRadius: 8, padding: '8px 7px' }}>
            {/* Header */}
            <div style={{ textAlign: 'center', marginBottom: 8 }}>
              <div style={{ fontSize: 9, color: '#6a8099', marginBottom: 2 }}>{days[i]?.label}</div>
              <div style={{ fontSize: 18, lineHeight: 1 }}>{FC_ICON[rag]}</div>
              <div style={{ fontSize: 9, fontWeight: 700, color: FC_COLOR[rag], marginTop: 2 }}>{rag}</div>
            </div>

            {/* Wind */}
            <div style={{ marginBottom: 6 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 2 }}>
                <span style={{ fontSize: 8, color: '#6a8099' }}>💨 Wind</span>
                <span style={{ fontSize: 10, fontWeight: 700, color: gc }}>{mph} mph</span>
              </div>
              <div style={{ height: 3, background: 'rgba(255,255,255,0.06)', borderRadius: 2 }}>
                <div style={{ width: `${Math.min(100, (day.gust / maxGust) * 100)}%`, background: gc, height: '100%', borderRadius: 2 }} />
              </div>
            </div>

            {/* Rain */}
            <div style={{ marginBottom: hasSnow ? 6 : 4 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 2 }}>
                <span style={{ fontSize: 8, color: '#6a8099' }}>🌧 Rain</span>
                <span style={{ fontSize: 10, fontWeight: 700, color: '#81C784' }}>{day.rain} mm</span>
              </div>
              <div style={{ height: 3, background: 'rgba(255,255,255,0.06)', borderRadius: 2 }}>
                <div style={{ width: `${Math.min(100, (day.rain / maxRain) * 100)}%`, background: '#81C784', height: '100%', borderRadius: 2 }} />
              </div>
            </div>

            {/* Snow — only row when any day has snow */}
            {hasSnow && (
              <div style={{ marginBottom: 4 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 2 }}>
                  <span style={{ fontSize: 8, color: '#6a8099' }}>❄ Snow</span>
                  <span style={{ fontSize: 10, fontWeight: 700, color: '#B0C4DE' }}>{day.snow ?? 0} cm</span>
                </div>
                <div style={{ height: 3, background: 'rgba(255,255,255,0.06)', borderRadius: 2 }}>
                  <div style={{ width: `${Math.min(100, ((day.snow ?? 0) / maxSnow) * 100)}%`, background: '#B0C4DE', height: '100%', borderRadius: 2 }} />
                </div>
              </div>
            )}

            {/* Temperature */}
            <div style={{ textAlign: 'center', paddingTop: 4, borderTop: '1px solid rgba(255,255,255,0.06)' }}>
              <span style={{ fontSize: 15, fontWeight: 800, color: tc }}>{Math.round(day.tmax)}°</span>
              <span style={{ fontSize: 8, color: '#4a6070' }}> C</span>
            </div>
          </div>
        );
      })}
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

  const networkWeather = forecastData?.primaries
    ? computeNetworkWeather(forecastData.primaries, forecastData.days?.length ?? 3)
    : null;

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
        <button className={`faults-ctrl-btn${forecastOverlayActive ? ' faults-ctrl-btn--active' : ''}`} style={{ marginBottom: 12, width: '100%' }} onClick={() => onOverlayToggle?.(!forecastOverlayActive)}>
          {forecastOverlayActive ? '🗺 Forecast Overlay ON' : '🗺 Show Overlay on Map'}
        </button>

        {/* 3-day weather visualisation */}
        {primary ? (<>
          <p style={{ fontSize: 10, fontWeight: 700, color: '#8899aa', marginBottom: 6 }}>{selectedSubstation.name}</p>
          <WeatherCards days={forecastData.days} weatherDays={primary.days} />
          <p style={{ fontSize: 10, color: '#6a8099', marginBottom: 10 }}>
            Vulnerability: <strong style={{ color: primary.vuln > 1.2 ? '#FF9500' : primary.vuln > 1.0 ? '#FFD700' : '#4FC3F7' }}>
              {primary.vuln <= 0.7 ? 'Low' : primary.vuln <= 1.0 ? 'Below avg' : primary.vuln <= 1.2 ? 'Above avg' : 'High'}
            </strong> ({primary.vuln}×)
          </p>
        </>) : networkWeather ? (<>
          <p style={{ fontSize: 10, fontWeight: 700, color: '#8899aa', marginBottom: 2 }}>Network weather — all zones avg</p>
          <p style={{ fontSize: 9, color: '#3a5268', marginBottom: 6 }}>Select a primary on the map for site-specific forecast</p>
          <WeatherCards days={forecastData.days} weatherDays={networkWeather} />
        </>) : (
          <p style={{ fontSize: 11, color: '#6a8099', marginBottom: 10 }}>
            {nrn ? `No forecast model data for NRN ${nrn}.` : 'Select a primary substation to view site-specific forecast.'}
          </p>
        )}

        <p style={{ fontSize:9, color:'#2e4460', borderTop:'1px solid rgba(255,255,255,0.04)', paddingTop:6 }}>
          Weather: Open-Meteo · Model: Z-score sigmoid regression · Calibrated to NAFIRS<br />
          Generated: {new Date(forecastData.generatedAt).toLocaleTimeString('en-GB', { hour:'2-digit', minute:'2-digit' })}
          {forecastData.modelMeta?.loyoRho != null && <> · CV ρ={forecastData.modelMeta.loyoRho} ±{forecastData.modelMeta.loyoStd}</>}
          {' '}<span style={{ color:'#3a5268' }}>— see Model tab</span>
        </p>
      </>)}
    </div>
  );
}

function ModelTab({ forecastData, onFetchForecast, loading, error }) {
  const meta = forecastData?.modelMeta;

  if (!meta) return (
    <div style={{ paddingTop: 8 }}>
      {loading && <p style={{ fontSize: 11, color: '#6a8099' }}>Loading model data…</p>}
      {error   && <p style={{ fontSize: 11, color: '#FF4444' }}>⚠ {error}</p>}
      {!loading && !error && (
        <div style={{ textAlign: 'center', paddingTop: 20 }}>
          <p style={{ fontSize: 11, color: '#6a8099', marginBottom: 12 }}>Forecast model not yet loaded.</p>
          <button className="faults-ctrl-btn" onClick={onFetchForecast}>Load Model Data</button>
        </div>
      )}
    </div>
  );

  const loyo  = meta.loyoRho;
  const held  = meta.spearmanR;
  const pers  = meta.persistenceRho;
  const loyoColor = loyo == null ? '#6a8099' : loyo >= 0.7 ? '#00E676' : loyo >= 0.5 ? '#FFD700' : '#FF4444';
  const loyoLabel = loyo == null ? '—' : loyo >= 0.7 ? 'Strong' : loyo >= 0.5 ? 'Moderate' : 'Weak';
  const weights = meta.weatherWeights || {};
  const maxW = Math.max(...Object.values(weights));

  return (
    <div style={{ fontSize: 11 }}>
      {/* Header card */}
      <div style={{ background: 'rgba(79,195,247,0.07)', border: '1px solid rgba(79,195,247,0.2)', borderRadius: 8, padding: '10px 12px', marginBottom: 12 }}>
        <div style={{ fontWeight: 700, color: '#4FC3F7', fontSize: 12, marginBottom: 4 }}>{meta.method}</div>
        <p style={{ color: '#8899aa', lineHeight: 1.6, margin: 0 }}>{meta.description}</p>
      </div>

      {/* Primary metric: LOYO CV */}
      <div style={{ fontWeight: 700, color: '#6a8099', fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 8 }}>Validation — Leave-One-Year-Out CV</div>
      <div style={{ background: 'rgba(255,255,255,0.03)', border: `1px solid ${loyoColor}33`, borderRadius: 8, padding: '10px 14px', marginBottom: 8, display: 'flex', alignItems: 'center', gap: 12 }}>
        <div style={{ textAlign: 'center', minWidth: 56 }}>
          <div style={{ fontSize: 24, fontWeight: 800, color: loyoColor, lineHeight: 1 }}>{loyo ?? '—'}</div>
          <div style={{ fontSize: 9, color: loyoColor, marginTop: 2 }}>ρ mean</div>
        </div>
        <div>
          <div style={{ fontWeight: 700, color: loyoColor, marginBottom: 3 }}>{loyoLabel} predictive rank correlation</div>
          <div style={{ color: '#6a8099', lineHeight: 1.5 }}>
            Each of {meta.loyoFolds} years held out in turn; model trained on remaining {(meta.loyoFolds ?? 1) - 1}.
            Std ±{meta.loyoStd} across folds.
          </div>
        </div>
      </div>
      <p style={{ fontSize: 9, color: '#3a5268', marginBottom: 14, lineHeight: 1.6 }}>
        LOYO CV is the primary metric — it uses all years and avoids reliance on any single split.
        Held-out test ρ ({meta.testYears?.join('–')}): <strong style={{ color: '#6a8099' }}>{held}</strong>.
        Base signal (yr-on-yr persistence ρ): <strong style={{ color: '#6a8099' }}>{pers}</strong> — fault rates are stable year-to-year because infrastructure doesn't change quickly.
      </p>

      {/* Training coverage */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 6, marginBottom: 14 }}>
        {[
          ['Sites trained', `${meta.trainSize}`, '#4FC3F7'],
          ['Train years',   `${meta.trainYears?.[0]}–${meta.trainYears?.at(-1)}`, '#aaa'],
          ['Test years',    meta.testYears?.join(', ') || '—', '#aaa'],
        ].map(([label, val, col]) => (
          <div key={label} style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.06)', borderRadius: 6, padding: '8px 10px', textAlign: 'center' }}>
            <div style={{ fontSize: 12, fontWeight: 700, color: col, marginBottom: 3 }}>{val}</div>
            <div style={{ fontSize: 9, color: '#4a6070' }}>{label}</div>
          </div>
        ))}
      </div>

      {/* Weather feature weights */}
      <div style={{ fontWeight: 700, color: '#6a8099', fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 8 }}>Weather Feature Weights</div>
      <div style={{ marginBottom: 14 }}>
        {[['Wind gusts', weights.wind, '#4FC3F7'], ['Rainfall', weights.rain, '#81C784'], ['Snowfall', weights.snow, '#B0C4DE'], ['Temperature', weights.temp, '#FFD700']].map(([label, w, col]) => (
          <div key={label} style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
            <div style={{ width: 90, color: '#8899aa', flexShrink: 0 }}>{label}</div>
            <div style={{ flex: 1, background: 'rgba(255,255,255,0.05)', borderRadius: 3, height: 8, overflow: 'hidden' }}>
              <div style={{ width: `${(w / maxW) * 100}%`, background: col, height: '100%', borderRadius: 3 }} />
            </div>
            <div style={{ width: 32, textAlign: 'right', color: col, fontWeight: 700 }}>{w}%</div>
          </div>
        ))}
      </div>

      {/* Model parameters */}
      <div style={{ fontWeight: 700, color: '#6a8099', fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 6 }}>Fitted Parameters</div>
      <div style={{ fontFamily: 'monospace', fontSize: 10, color: '#4a6070', lineHeight: 1.8, background: 'rgba(0,0,0,0.2)', borderRadius: 6, padding: '8px 10px', marginBottom: 12 }}>
        <span style={{ color: '#4FC3F7' }}>vuln</span> = 0.60 + σ( (<span style={{ color: '#FFD700' }}>rate</span> − {meta.mu}) / {meta.sig} ) × 0.90<br />
        <span style={{ color: '#6a8099' }}>range: [0.60, 1.50] · σ = sigmoid · rate = faults/feeder/yr</span>
      </div>

      {/* RAG thresholds */}
      <div style={{ fontWeight: 700, color: '#6a8099', fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 6 }}>RAG Thresholds (risk score)</div>
      <div style={{ display: 'flex', gap: 6 }}>
        {[['Green', `< ${meta.ragThresholds?.yellow}`, '#00E676'], ['Yellow', `${meta.ragThresholds?.yellow}–${meta.ragThresholds?.red}`, '#FFD700'], ['Red', `≥ ${meta.ragThresholds?.red}`, '#FF4444']].map(([rag, thr, col]) => (
          <div key={rag} style={{ flex: 1, textAlign: 'center', background: `${col}11`, border: `1px solid ${col}33`, borderRadius: 6, padding: '6px 4px' }}>
            <div style={{ color: col, fontWeight: 700, fontSize: 12 }}>{rag}</div>
            <div style={{ color: '#6a8099', fontSize: 9, marginTop: 2 }}>{thr}</div>
          </div>
        ))}
      </div>

      <p style={{ fontSize: 9, color: '#2e4460', borderTop: '1px solid rgba(255,255,255,0.04)', paddingTop: 8, marginTop: 12, lineHeight: 1.6 }}>
        Vulnerability model: SSEN NAFIRS HV SEPD · Weather: Open-Meteo ·
        Generated: {new Date(forecastData.generatedAt).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}
      </p>
    </div>
  );
}

const TABS = ['Live', 'CML', 'History', 'Forecast', 'Model'];

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
  const loadForecast = useCallback(() => {
    if (forecastData) return;
    setFcLoading(true); setFcError(null);
    fetchForecast()
      .then(d => { onForecastLoaded?.(d); setFcLoading(false); })
      .catch(e => { setFcError(e.message); setFcLoading(false); });
  }, [forecastData, onForecastLoaded]);

  useEffect(() => {
    if (activeTab !== 'Forecast' && activeTab !== 'Model') return;
    loadForecast();
  }, [activeTab, loadForecast]);

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
        {activeTab === 'Model' && (
          <ModelTab forecastData={forecastData} onFetchForecast={loadForecast} loading={fcLoading} error={fcError} />
        )}
      </div>
    </div>
  );
}
