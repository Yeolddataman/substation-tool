import { useState, useEffect, useRef } from 'react';
import { getToken } from '../lib/auth';

// ── Name normalisation (mirrors normPrimary in DataQualityPage) ────────────
const normName = (name = '') =>
  name.toUpperCase()
    .replace(/\s+(PRIMARY|GSP|BSP|SUBSTATION|GRID|SWITCHING STATION)$/, '')
    .replace(/\s+/g, ' ')
    .trim();

// ── Short-term key store (sessionStorage, cleared on browser close) ────────
// NERDA data endpoints only accept short-term Bearer tokens obtained by
// logging into the NERDA portal. The long-term key cannot be used directly
// with data endpoints. The user pastes their portal key here; it lasts 1 h.
const NERDA_KEY_SS = 'nerda_short_term_key';
const NERDA_KEY_TS = 'nerda_short_term_key_ts';

function getShortTermKey() {
  return sessionStorage.getItem(NERDA_KEY_SS) || '';
}
function setShortTermKey(k) {
  sessionStorage.setItem(NERDA_KEY_SS, k);
  sessionStorage.setItem(NERDA_KEY_TS, Date.now().toString());
}
function shortTermKeyAge() {
  const ts = Number(sessionStorage.getItem(NERDA_KEY_TS) || 0);
  return ts ? Math.floor((Date.now() - ts) / 60_000) : null; // minutes
}
function clearShortTermKey() {
  sessionStorage.removeItem(NERDA_KEY_SS);
  sessionStorage.removeItem(NERDA_KEY_TS);
}

// ── Module-level caches (survive tab switches, cleared on page reload) ─────
const _substationCache = new Map();    // name → { data, ts }
const _timeseriesCache = new Map();    // measurementId → { points, ts }
const SUBSTATION_TTL  = 15 * 60_000;  // 15 min
const TIMESERIES_TTL  =  5 * 60_000;  //  5 min (short window — data changes quickly)

function appAuthHeaders() {
  return { Authorization: `Bearer ${getToken()}`, 'Content-Type': 'application/json' };
}
function nerdaProxyHeaders(shortKey) {
  // Pass the short-term key to the server proxy via a custom header
  return { ...appAuthHeaders(), 'X-Nerda-Key': shortKey };
}

// Fetch substation by name — tries sds_site_id variants to avoid the
// full-list endpoint which returns 500 (too much data to serve at once).
async function fetchSubstationByName(subName, shortKey) {
  const norm = normName(subName);
  const cached = _substationCache.get(norm);
  if (cached && Date.now() - cached.ts < SUBSTATION_TTL) return cached.data;

  // Try progressively shorter name variants in case NERDA uses a truncated id
  const variants = [
    norm,
    subName.toUpperCase().trim(),
    norm.replace(/[^A-Z0-9 ]/g, ''),  // alphanumeric only
  ];

  for (const v of variants) {
    const r = await fetch(
      `/api/nerda/substations?name=${encodeURIComponent(v)}`,
      { headers: nerdaProxyHeaders(shortKey) }
    );
    if (r.ok) {
      const data = await r.json();
      // Check we actually got a station (not an empty result)
      const station = Array.isArray(data) ? data[0] : data;
      if (station?.lines || station?.sds_site_id) {
        _substationCache.set(norm, { data: station, ts: Date.now() });
        return station;
      }
    }
  }
  return null; // not found
}

async function fetchTimeseries(measurementId, after, shortKey) {
  const cached = _timeseriesCache.get(measurementId);
  if (cached && Date.now() - cached.ts < TIMESERIES_TTL) return cached.points;
  const r = await fetch(
    `/api/nerda/timeseries?measurement=${encodeURIComponent(measurementId)}&after=${encodeURIComponent(after)}`,
    { headers: nerdaProxyHeaders(shortKey) }
  );
  if (!r.ok) throw new Error(`NERDA ${r.status}`);
  const data = await r.json();
  // NERDA response: { aliasName, AnalogValues: [{ timeStamp, aliasName, value_history: [{_ts, value}] }] }
  const history =
    Array.isArray(data?.AnalogValues?.[0]?.value_history) ? data.AnalogValues[0].value_history
    : Array.isArray(data?.value_history)                  ? data.value_history
    : Array.isArray(data)                                 ? data
    : [];
  _timeseriesCache.set(measurementId, { points: history, ts: Date.now() });
  return history;
}

// ── Helpers ────────────────────────────────────────────────────────────────
// NERDA static response structure (per API guide):
//   { sds_site_id, latitude, longitude,
//     lines: [{ line_name, nerda_line_uuid,
//               measurements: [{ nerda_measurement_id, measurementType, unitSymbol, unitMultiplier }] }] }
//
// measurementType values seen: LineCurrent, ActivePower, ApparentPower, Voltage, ReactivePower
const TYPE_LABEL = {
  activepower:    { label: 'Active Power',    unit: 'MW'  },
  realpower:      { label: 'Active Power',    unit: 'MW'  },
  apparentpower:  { label: 'Apparent Power',  unit: 'MVA' },
  reactivepower:  { label: 'Reactive Power',  unit: 'MVAr'},
  linecurrent:    { label: 'Current',         unit: 'A'   },
  current:        { label: 'Current',         unit: 'A'   },
  voltage:        { label: 'Voltage',         unit: 'kV'  },
};

// Priority order for display (show most useful metrics first)
const TYPE_PRIORITY = ['activepower', 'apparentpower', 'linecurrent', 'voltage', 'reactivepower'];

function pickMeasurements(detail) {
  // Flatten all measurement objects from lines[]
  const all = [];
  const substation = Array.isArray(detail) ? detail[0] : detail;
  for (const line of substation?.lines || []) {
    for (const m of line?.measurements || []) {
      if (m.nerda_measurement_id) {
        all.push({
          id:   m.nerda_measurement_id,
          type: (m.measurementType || '').toLowerCase().replace(/\s+/g, ''),
          unit: m.unitSymbol || '',
          name: m.measurementType || m.nerda_measurement_id,
          line: line.line_name || '',
        });
      }
    }
  }

  if (all.length === 0) return [];

  const picked = [];
  const usedTypes = new Set();

  // Pick one measurement per type in priority order
  for (const typeKey of TYPE_PRIORITY) {
    if (picked.length >= 4) break;
    if (usedTypes.has(typeKey)) continue;
    const m = all.find(x => x.type === typeKey || x.type.includes(typeKey));
    if (m) {
      const meta = TYPE_LABEL[typeKey] || { label: m.name, unit: m.unit };
      picked.push({ id: m.id, label: meta.label, unit: m.unit || meta.unit, name: m.name, line: m.line });
      usedTypes.add(typeKey);
    }
  }

  // Fallback: take first few if nothing matched
  if (picked.length === 0) {
    for (const m of all.slice(0, 3)) {
      picked.push({ id: m.id, label: m.name, unit: m.unit, name: m.name, line: m.line });
    }
  }

  return picked;
}

// ── Mini sparkline SVG ──────────────────────────────────────────────────────
function Sparkline({ points, color = '#00BCD4', height = 40 }) {
  if (!points || points.length < 2) return null;

  // NERDA value_history entries: {_ts, value} — may also include rms/average variants
  const values = points.map(p =>
    typeof p === 'number' ? p : p?.value ?? p?.rms ?? p?.average ?? p?.v ?? null
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
function MeasurementCard({ label, unit, points, color, line }) {
  const values = (points || []).map(p =>
    typeof p === 'number' ? p : p?.value ?? p?.rms ?? p?.average ?? p?.v ?? null
  ).filter(v => v != null && isFinite(v));

  const latest = values[values.length - 1];
  const min    = values.length ? Math.min(...values) : null;
  const max    = values.length ? Math.max(...values) : null;
  const fmt    = v => v == null ? '—' : Math.abs(v) >= 100 ? v.toFixed(1) : v.toFixed(2);

  return (
    <div style={CS.card}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 4 }}>
        <span style={CS.cardLabel}>{label}</span>
        <span style={{ fontSize: 16, fontWeight: 700, color }}>{fmt(latest)}<span style={{ fontSize: 10, color: '#5a7299', marginLeft: 3 }}>{unit}</span></span>
      </div>
      {line && <div style={{ fontSize: 9, color: '#3a5268', marginBottom: 3 }}>{line}</div>}
      <Sparkline points={points} color={color} height={36} />
      <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 4 }}>
        <span style={CS.stat}>Min {fmt(min)} {unit}</span>
        <span style={CS.stat}>Max {fmt(max)} {unit}</span>
        <span style={CS.stat}>{values.length} readings</span>
      </div>
    </div>
  );
}

// ── Key entry panel ─────────────────────────────────────────────────────────
function KeyEntryPanel({ onKeySet }) {
  const [draft, setDraft] = useState('');
  const age = shortTermKeyAge();
  const existing = getShortTermKey();

  return (
    <div style={{ fontSize: 11, color: '#8899aa', lineHeight: 1.6 }}>
      {existing && age !== null && (
        <div style={{ marginBottom: 8, color: age >= 55 ? '#FF4444' : '#00BCD4', fontSize: 10 }}>
          {age >= 55
            ? '⚠ Key may have expired (entered >55 min ago). Paste a new one.'
            : `Key entered ${age} min ago · valid for ~${60 - age} more min`}
        </div>
      )}
      <div style={{ marginBottom: 6 }}>
        NERDA data endpoints require a <strong style={{ color: '#cdd' }}>short-term portal key</strong>
        {' '}(valid 1 hour).
      </div>
      <ol style={{ margin: '0 0 10px 16px', padding: 0, fontSize: 10, color: '#6a8299' }}>
        <li>Log in at <span style={{ color: '#4FC3F7' }}>nerda.ssen.co.uk</span></li>
        <li>Open the ☰ menu (top right)</li>
        <li>Click <em>Copy Short-Term API Key</em></li>
        <li>Paste it below</li>
      </ol>
      <input
        type="password"
        placeholder="Paste short-term API key…"
        value={draft}
        onChange={e => setDraft(e.target.value)}
        style={{
          width: '100%', boxSizing: 'border-box',
          padding: '6px 8px', borderRadius: 5,
          background: 'rgba(255,255,255,0.05)',
          border: '1px solid rgba(0,188,212,0.3)',
          color: '#cdd', fontSize: 11, fontFamily: 'inherit',
          marginBottom: 6,
        }}
      />
      <button
        onClick={() => { if (draft.trim()) { setShortTermKey(draft.trim()); onKeySet(); } }}
        disabled={!draft.trim()}
        style={{ ...CS.loadBtn, opacity: draft.trim() ? 1 : 0.4 }}
      >
        Use this key
      </button>
    </div>
  );
}

// ── Main tab component ──────────────────────────────────────────────────────
export default function NerdaTab({ sub }) {
  const [phase, setPhase]         = useState('idle');   // idle | need-key | searching | loading | ready | error | not-found
  const [nerdaUuid, setNerdaUuid] = useState(null);
  const [nerdaName, setNerdaName] = useState(null);
  const [measurements, setMeasurements] = useState([]);
  const [errorMsg, setErrorMsg]   = useState('');
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  useEffect(() => {
    setPhase('idle');
    setNerdaUuid(null);
    setNerdaName(null);
    setMeasurements([]);
    setErrorMsg('');
  }, [sub?.id]);

  const load = async () => {
    if (!sub || sub.type !== 'Primary') return;

    const shortKey = getShortTermKey();
    if (!shortKey) { setPhase('need-key'); return; }

    setPhase('searching');
    setErrorMsg('');

    try {
      // Step 1: find substation by name directly (avoids full-list 500)
      const station = await fetchSubstationByName(sub.name, shortKey);
      if (!mountedRef.current) return;

      if (!station) {
        setPhase('not-found');
        return;
      }

      setNerdaName(station.sds_site_id || sub.name);
      setPhase('loading');

      // Step 2: pick measurements from the same response (no second API call needed)
      const picked = pickMeasurements(station);

      if (picked.length === 0) {
        setPhase('ready');
        setMeasurements([]);
        return;
      }

      // Step 3: fetch last 30 min of time-series for each selected measurement
      const after = new Date(Date.now() - 30 * 60_000).toISOString();

      // Fetch sequentially to be kind to the API
      const results = [];
      for (const m of picked) {
        if (!mountedRef.current) return;
        try {
          const points = await fetchTimeseries(m.id, after, shortKey);
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
      const msg = e.message || 'Unknown error';
      if (msg.includes('401') || msg.includes('403')) {
        // Key likely expired — clear it and ask for a new one
        clearShortTermKey();
        setPhase('need-key');
        return;
      }
      setErrorMsg(
        msg.includes('503') ? 'Server configuration error. Check Railway environment variables.'
        : msg.includes('502') ? 'Could not reach NERDA API. Check server logs for details.'
        : msg
      );
      setPhase('error');
    }
  };

  const COLORS = ['#00BCD4', '#00E676', '#FF9500', '#9C27B0'];

  const after30m = new Date(Date.now() - 30 * 60_000);
  const timeLabel = `${after30m.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })} — now`;

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
          Fetch last 30 min of load data
        </button>
      )}

      {phase === 'need-key' && (
        <KeyEntryPanel onKeySet={() => { setPhase('idle'); load(); }} />
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
                  line={m.line}
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
        Source: SSEN NeRDA Portal · SCADA PowerOn · 10-min intervals · Last 30 minutes
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
