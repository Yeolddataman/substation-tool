import { useState, useEffect, useRef } from 'react';
import { getToken } from '../lib/auth';

// ── Name normalisation (mirrors normPrimary in DataQualityPage) ────────────
const normName = (name = '') =>
  name.toUpperCase()
    .replace(/\s+(PRIMARY|GSP|BSP|SUBSTATION|GRID|SWITCHING STATION)$/, '')
    .replace(/\s+/g, ' ')
    .trim();

// ── Module-level caches (survive tab switches, cleared on page reload) ─────
let _allStationsCache = null;          // full NERDA station list
let _allStationsPromise = null;        // in-flight request de-duplication
const _substationCache = new Map();    // uuid → { data, ts }
const _timeseriesCache = new Map();    // measurementId → { points, ts }
const SUBSTATION_TTL  = 15 * 60_000;  // 15 min
const TIMESERIES_TTL  = 10 * 60_000;  // 10 min

function authHeaders() {
  return { Authorization: `Bearer ${getToken()}`, 'Content-Type': 'application/json' };
}

async function fetchAllStations() {
  if (_allStationsCache) return _allStationsCache;
  if (_allStationsPromise) return _allStationsPromise;
  _allStationsPromise = fetch('/api/nerda/substations', { headers: authHeaders() })
    .then(r => { if (!r.ok) throw new Error(`NERDA ${r.status}`); return r.json(); })
    .then(data => { _allStationsCache = data; _allStationsPromise = null; return data; })
    .catch(e => { _allStationsPromise = null; throw e; });
  return _allStationsPromise;
}

async function fetchSubstationDetail(uuid) {
  const cached = _substationCache.get(uuid);
  if (cached && Date.now() - cached.ts < SUBSTATION_TTL) return cached.data;
  const r = await fetch(`/api/nerda/substations?uuid=${encodeURIComponent(uuid)}`, { headers: authHeaders() });
  if (!r.ok) throw new Error(`NERDA ${r.status}`);
  const data = await r.json();
  _substationCache.set(uuid, { data, ts: Date.now() });
  return data;
}

async function fetchTimeseries(measurementId, after) {
  const key = `${measurementId}__${after}`;
  const cached = _timeseriesCache.get(measurementId);
  if (cached && Date.now() - cached.ts < TIMESERIES_TTL) return cached.points;
  const r = await fetch(
    `/api/nerda/timeseries?measurement=${encodeURIComponent(measurementId)}&after=${encodeURIComponent(after)}`,
    { headers: authHeaders() }
  );
  if (!r.ok) throw new Error(`NERDA ${r.status}`);
  const data = await r.json();
  // Extract value_history array — API may wrap in an object or return the array directly
  const history = Array.isArray(data) ? data
    : Array.isArray(data?.value_history) ? data.value_history
    : Array.isArray(data?.data) ? data.data
    : [];
  _timeseriesCache.set(measurementId, { points: history, ts: Date.now() });
  return history;
}

// ── Helpers ────────────────────────────────────────────────────────────────
function pickMeasurements(detail) {
  // Walk lines/transformers in the static response and collect measurement IDs
  // Prioritise: Active Power (MW), Apparent Power (MVA), Current (A), Voltage (kV)
  const PRIORITY = [
    { keys: ['activepow', 'active_pow', 'mw', 'real_pow', 'p_'], label: 'Active Power', unit: 'MW' },
    { keys: ['apparentpow', 'apparent_pow', 'mva', 'kva'],        label: 'Apparent Power', unit: 'MVA' },
    { keys: ['current', 'linecurrent', 'amps', '_i'],             label: 'Current', unit: 'A' },
    { keys: ['voltage', 'volts', 'kv', '_v'],                     label: 'Voltage', unit: 'kV' },
  ];

  // Flatten all measurements from the detail response
  const all = [];
  const walk = (obj) => {
    if (!obj || typeof obj !== 'object') return;
    if (Array.isArray(obj)) { obj.forEach(walk); return; }
    // Measurement entries typically have nerda_measurement_id
    if (obj.nerda_measurement_id) {
      all.push({ id: obj.nerda_measurement_id, name: obj.name || obj.measurement_name || '', raw: obj });
    }
    Object.values(obj).forEach(walk);
  };
  walk(detail);

  const matched = [];
  const used = new Set();

  for (const priority of PRIORITY) {
    if (matched.length >= 4) break;
    for (const m of all) {
      if (used.has(m.id)) continue;
      const n = (m.name || m.id).toLowerCase();
      if (priority.keys.some(k => n.includes(k))) {
        matched.push({ id: m.id, label: priority.label, unit: priority.unit, name: m.name });
        used.add(m.id);
        break;
      }
    }
  }

  // If nothing matched by keyword, take first 3
  if (matched.length === 0) {
    for (const m of all.slice(0, 3)) {
      matched.push({ id: m.id, label: m.name || m.id, unit: '', name: m.name });
    }
  }

  return matched;
}

// ── Mini sparkline SVG ──────────────────────────────────────────────────────
function Sparkline({ points, color = '#00BCD4', height = 40 }) {
  if (!points || points.length < 2) return null;

  const values = points.map(p =>
    typeof p === 'number' ? p
    : p?.value ?? p?.rms ?? p?.average ?? p?.v ?? null
  ).filter(v => v != null && isFinite(v));

  if (values.length < 2) return null;

  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;
  const W = 240;
  const H = height;
  const pad = 2;

  const pts = values.map((v, i) => {
    const x = pad + (i / (values.length - 1)) * (W - pad * 2);
    const y = H - pad - ((v - min) / range) * (H - pad * 2);
    return `${x},${y}`;
  }).join(' ');

  return (
    <svg width={W} height={H} style={{ display: 'block', overflow: 'visible' }}>
      <polyline
        points={pts}
        fill="none"
        stroke={color}
        strokeWidth="1.5"
        strokeLinejoin="round"
        strokeLinecap="round"
        opacity="0.9"
      />
      {/* Shade under the line */}
      <polygon
        points={`${pad},${H} ${pts} ${W - pad},${H}`}
        fill={color}
        opacity="0.08"
      />
    </svg>
  );
}

// ── Measurement card ────────────────────────────────────────────────────────
function MeasurementCard({ label, unit, points, color }) {
  const values = (points || []).map(p =>
    typeof p === 'number' ? p
    : p?.value ?? p?.rms ?? p?.average ?? p?.v ?? null
  ).filter(v => v != null && isFinite(v));

  const latest = values[values.length - 1];
  const min    = values.length ? Math.min(...values) : null;
  const max    = values.length ? Math.max(...values) : null;
  const fmt    = v => v == null ? '—' : Math.abs(v) >= 100 ? v.toFixed(1) : v.toFixed(2);

  return (
    <div style={CS.card}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 4 }}>
        <span style={CS.cardLabel}>{label}</span>
        <span style={{ fontSize: 16, fontWeight: 700, color }}>{fmt(latest)} <span style={{ fontSize: 10, color: '#5a7299' }}>{unit}</span></span>
      </div>
      <Sparkline points={points} color={color} height={36} />
      <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 4 }}>
        <span style={CS.stat}>Min {fmt(min)} {unit}</span>
        <span style={CS.stat}>Max {fmt(max)} {unit}</span>
        <span style={CS.stat}>{values.length} readings</span>
      </div>
    </div>
  );
}

// ── Main tab component ──────────────────────────────────────────────────────
export default function NerdaTab({ sub }) {
  const [phase, setPhase]       = useState('idle');   // idle | searching | loading | ready | error | not-found
  const [nerdaUuid, setNerdaUuid] = useState(null);
  const [nerdaName, setNerdaName] = useState(null);
  const [measurements, setMeasurements] = useState([]);  // [{ id, label, unit, points }]
  const [errorMsg, setErrorMsg] = useState('');
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  useEffect(() => {
    // Reset when substation changes
    setPhase('idle');
    setNerdaUuid(null);
    setNerdaName(null);
    setMeasurements([]);
    setErrorMsg('');
  }, [sub?.id]);

  const load = async () => {
    if (!sub || sub.type !== 'Primary') return;
    setPhase('searching');
    setErrorMsg('');

    try {
      // Step 1: find the NERDA UUID by matching name
      const allStations = await fetchAllStations();
      const myNorm = normName(sub.name);

      // allStations may be an array or object — normalise
      const list = Array.isArray(allStations) ? allStations
        : Array.isArray(allStations?.substations) ? allStations.substations
        : Array.isArray(allStations?.data) ? allStations.data
        : Object.values(allStations);

      const match = list.find(s => {
        const sName = s.name || s.substation_name || s.displayName || '';
        return normName(sName) === myNorm;
      });

      if (!mountedRef.current) return;

      if (!match) {
        setPhase('not-found');
        return;
      }

      const uuid = match.id || match.uuid || match.substation_id || match.nerda_id;
      setNerdaUuid(uuid);
      setNerdaName(match.name || match.substation_name || match.displayName);
      setPhase('loading');

      // Step 2: get measurement IDs for this substation
      const detail = await fetchSubstationDetail(uuid);
      if (!mountedRef.current) return;

      const picked = pickMeasurements(detail);

      if (picked.length === 0) {
        setPhase('ready');
        setMeasurements([]);
        return;
      }

      // Step 3: fetch last 12h of time-series for each selected measurement
      const after = new Date(Date.now() - 12 * 60 * 60_000).toISOString();

      // Fetch sequentially to be kind to the API
      const results = [];
      for (const m of picked) {
        if (!mountedRef.current) return;
        try {
          const points = await fetchTimeseries(m.id, after);
          results.push({ ...m, points });
        } catch {
          results.push({ ...m, points: [] });
        }
      }

      if (!mountedRef.current) return;
      setMeasurements(results);
      setPhase('ready');

    } catch (e) {
      if (!mountedRef.current) return;
      setErrorMsg(e.message || 'Unknown error');
      setPhase('error');
    }
  };

  const COLORS = ['#00BCD4', '#00E676', '#FF9500', '#9C27B0'];

  const after12h = new Date(Date.now() - 12 * 60 * 60_000);
  const timeLabel = `${after12h.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })} — now`;

  if (sub?.type !== 'Primary') {
    return (
      <section className="sidebar-section">
        <p className="section-text" style={{ opacity: 0.5, fontSize: '0.75rem' }}>
          Near real-time load data is only available for Primary substations.
        </p>
      </section>
    );
  }

  return (
    <section className="sidebar-section">
      <h3 className="section-title">Near Real-Time Load (NERDA)</h3>

      {phase === 'idle' && (
        <button onClick={load} style={CS.loadBtn}>
          Fetch last 12h of load data
        </button>
      )}

      {phase === 'searching' && (
        <div style={CS.status}>
          <span style={{ color: '#FF9500' }}>⏳</span> Searching NERDA for {sub.name}…
        </div>
      )}

      {phase === 'loading' && (
        <div style={CS.status}>
          <span style={{ color: '#FF9500' }}>⏳</span> Loading measurements for <em>{nerdaName}</em>…
        </div>
      )}

      {phase === 'not-found' && (
        <div style={CS.status}>
          <span style={{ color: '#FF4444' }}>✗</span> No NERDA match found for <em>{sub.name}</em>
          <div style={{ fontSize: 10, color: '#3a5268', marginTop: 4 }}>
            The substation may not be in NERDA's Phase 1 dataset, or the name differs from the mapped data.
          </div>
        </div>
      )}

      {phase === 'error' && (
        <div style={CS.status}>
          <span style={{ color: '#FF4444' }}>✗</span> Error: {errorMsg}
          <button onClick={load} style={{ ...CS.loadBtn, marginTop: 8 }}>Retry</button>
        </div>
      )}

      {phase === 'ready' && (
        <>
          <div style={{ fontSize: 10, color: '#5a7299', marginBottom: 10 }}>
            NERDA: <span style={{ color: '#4FC3F7' }}>{nerdaName}</span>
            &nbsp;· {timeLabel} · {measurements.reduce((n, m) => n + (m.points?.length || 0), 0)} readings
          </div>

          {measurements.length === 0 ? (
            <p className="section-text" style={{ opacity: 0.5, fontSize: '0.75rem' }}>
              No measurements returned for this substation.
            </p>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {measurements.map((m, i) => (
                <MeasurementCard
                  key={m.id}
                  label={m.label}
                  unit={m.unit}
                  points={m.points}
                  color={COLORS[i % COLORS.length]}
                />
              ))}
            </div>
          )}

          <button onClick={load} style={{ ...CS.loadBtn, marginTop: 12, opacity: 0.6, fontSize: 10 }}>
            Refresh
          </button>
        </>
      )}

      <p className="data-source-label" style={{ marginTop: 12 }}>
        Source: SSEN NeRDA Portal · SCADA PowerOn · 10-min intervals · Last 12 hours
      </p>
    </section>
  );
}

const CS = {
  loadBtn: {
    width: '100%',
    padding: '8px 0',
    background: 'rgba(0,188,212,0.1)',
    border: '1px solid rgba(0,188,212,0.3)',
    borderRadius: 6,
    color: '#00BCD4',
    fontSize: 12,
    cursor: 'pointer',
    fontFamily: 'inherit',
  },
  status: {
    fontSize: 11,
    color: '#8899aa',
    lineHeight: 1.5,
  },
  card: {
    background: 'rgba(255,255,255,0.03)',
    border: '1px solid rgba(255,255,255,0.06)',
    borderRadius: 6,
    padding: '10px 12px',
  },
  cardLabel: {
    fontSize: 10,
    fontWeight: 700,
    color: '#5a7299',
    textTransform: 'uppercase',
    letterSpacing: '0.05em',
  },
  stat: {
    fontSize: 9,
    color: '#3a5268',
  },
};
