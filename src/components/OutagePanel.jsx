import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Marker, Popup, GeoJSON } from 'react-leaflet';
import L from 'leaflet';

// ── Source ─────────────────────────────────────────────────────────────────
// robintw/sse_powercuts — mirrors the SSEN live outage feed as JSON
// Fields: UUID, reference, type, name, latitude, longitude, location (GeoJSON Polygon),
//         loggedAt, estimatedRestoration, affectedCustomerCount, affectedAreas, message, networkId
const OUTAGES_URL = 'https://raw.githubusercontent.com/robintw/sse_powercuts/master/outages.json';
const SEPD_NETWORK = 'com.sse.ssepd.sepd';

// ── Constants ──────────────────────────────────────────────────────────────
const TYPE_COLOR = { HV: '#FF9500', LV: '#FFD700', PSI: '#c084fc' };
const typeColor  = (t) => TYPE_COLOR[t] || '#aaa';

// Warning-triangle DivIcon — visually distinct from circular GSP/BSP markers
function faultDivIcon(type) {
  const color = typeColor(type);
  const size  = type === 'HV' ? 28 : 22;
  const half  = size / 2;
  const svg = `
    <svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 28 28"
         style="filter:drop-shadow(0 2px 5px rgba(0,0,0,0.7))">
      <polygon points="14,2 27,25 1,25"
        fill="${color}" fill-opacity="0.92" stroke="white" stroke-width="1.8" stroke-linejoin="round"/>
      <text x="14" y="22" text-anchor="middle" font-size="13" font-family="sans-serif" fill="white"
            style="user-select:none">⚡</text>
    </svg>`.trim();
  return L.divIcon({
    className: '',
    html: svg,
    iconSize:   [size, size],
    iconAnchor: [half, half],
    popupAnchor:[0, -half],
  });
}

// ── Helpers ────────────────────────────────────────────────────────────────
function stripHtml(str) {
  if (!str) return '';
  return str.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
}

function fmtDT(iso) {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleString('en-GB', {
      day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit',
    });
  } catch { return iso; }
}

function elapsed(iso) {
  if (!iso) return '—';
  try {
    const ms = Date.now() - new Date(iso).getTime();
    if (ms < 0) return 'Just logged';
    const h = Math.floor(ms / 3600000);
    const m = Math.floor((ms % 3600000) / 60000);
    return h > 0 ? `${h}h ${m}m` : `${m}m`;
  } catch { return '—'; }
}

// ── Fault polygon + centroid markers (exported → used inside MapContainer) ─
export function FaultMapMarkers({ outages, visible }) {
  if (!visible || !outages?.length) return null;

  return outages.map((o) => {
    const color = typeColor(o.type);

    const popupContent = (
      <div style={{ fontSize: 11, lineHeight: 1.6, minWidth: 230, maxWidth: 310 }}>
        <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 5, color }}>
          ⚡ {o.reference}
          <span style={{ fontWeight: 400, marginLeft: 8, color: '#bbb', fontSize: 11 }}>
            {o.type}
          </span>
        </div>
        <div style={{ fontWeight: 600, marginBottom: 3 }}>{o.name}</div>
        {o.affectedCustomerCount > 0 && (
          <div>👥 <strong>{o.affectedCustomerCount.toLocaleString()}</strong> customers affected</div>
        )}
        {o.networkType && (
          <div>🔌 {o.networkType.charAt(0).toUpperCase() + o.networkType.slice(1)} network</div>
        )}
        <div style={{ marginTop: 4 }}>
          <div>⏱ Logged: {fmtDT(o.loggedAt)} ({elapsed(o.loggedAt)} ago)</div>
          {o.estimatedRestoration && (
            <div>🔧 ETR: {fmtDT(o.estimatedRestoration)}</div>
          )}
          {o.estimatedArrivalOnSiteTime && (
            <div>🚐 Engineer ETA: {fmtDT(o.estimatedArrivalOnSiteTime)}</div>
          )}
        </div>
        {o.affectedAreas?.length > 0 && (
          <div style={{ marginTop: 5, fontSize: 10, color: '#aaa' }}>
            📍 {o.affectedAreas.slice(0, 6).join(', ')}
            {o.affectedAreas.length > 6 ? ` +${o.affectedAreas.length - 6} more` : ''}
          </div>
        )}
        {o.message && (
          <div style={{ marginTop: 6, fontSize: 10, fontStyle: 'italic', opacity: 0.75, borderTop: '1px solid rgba(255,255,255,0.1)', paddingTop: 5 }}>
            {stripHtml(o.message).slice(0, 200)}
            {stripHtml(o.message).length > 200 ? '…' : ''}
          </div>
        )}
      </div>
    );

    return (
      <React.Fragment key={o.UUID}>
        {/* Affected area polygon */}
        {o.location?.type === 'Polygon' && (
          <GeoJSON
            data={o.location}
            style={{
              fillColor: color, fillOpacity: 0.1,
              color, weight: 1.5, opacity: 0.5, dashArray: '5 4',
            }}
          />
        )}
        {/* Warning-triangle marker — distinct from circular GSP dots */}
        <Marker
          position={[o.latitude, o.longitude]}
          icon={faultDivIcon(o.type)}
        >
          <Popup className="fault-map-popup" maxWidth={320}>
            {popupContent}
          </Popup>
        </Marker>
      </React.Fragment>
    );
  });
}

// ── 24hr Restoration Timeline ─────────────────────────────────────────────
function FaultTimeline({ outages }) {
  const now = Date.now();
  const windowMs = 24 * 60 * 60 * 1000;
  const faultsWithEtr = outages
    .filter(o => o.estimatedRestoration)
    .map(o => ({
      ...o,
      _cml: Math.round((o.affectedCustomerCount || 0) * Math.max(0, (new Date(o.estimatedRestoration).getTime() - now) / 60000)),
    }))
    .sort((a, b) => b._cml - a._cml);

  if (faultsWithEtr.length === 0) return (
    <div style={{ fontSize: 10, color: '#3a5268', fontStyle: 'italic', marginTop: 8 }}>
      No ETR data available for timeline.
    </div>
  );

  const totalCml = faultsWithEtr.reduce((sum, o) => {
    const minsLeft = Math.max(0, (new Date(o.estimatedRestoration).getTime() - now) / 60000);
    return sum + (o.affectedCustomerCount || 0) * minsLeft;
  }, 0);

  return (
    <div style={{ marginTop: 14, borderTop: '1px solid rgba(255,255,255,0.06)', paddingTop: 12 }}>
      <div style={{ fontSize: 10, fontWeight: 700, color: '#8899aa', marginBottom: 10, textTransform: 'uppercase', letterSpacing: '0.07em' }}>
        24hr Restoration Timeline
      </div>

      {/* Hour ruler */}
      <div style={{ display: 'flex', paddingLeft: 84, marginBottom: 4 }}>
        {[0, 6, 12, 18, 24].map(h => (
          <div key={h} style={{ flex: h === 0 ? 0 : 6, fontSize: 9, color: '#3a5268', textAlign: h === 0 ? 'left' : 'center' }}>
            {h === 0 ? 'Now' : `+${h}h`}
          </div>
        ))}
      </div>

      {/* Fault rows */}
      {faultsWithEtr.map(o => {
        const color = typeColor(o.type);
        const etrMs = new Date(o.estimatedRestoration).getTime();
        const cml = o._cml;
        const barPct = Math.min(100, ((etrMs - now) / windowMs) * 100);
        const overflow = etrMs - now > windowMs;

        return (
          <div key={o.UUID} style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 5 }}>
            {/* Reference label */}
            <div style={{ width: 78, flexShrink: 0, fontSize: 9, color, fontWeight: 600, textAlign: 'right', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {o.reference}
            </div>
            {/* Bar track */}
            <div style={{ flex: 1, height: 16, background: 'rgba(255,255,255,0.04)', borderRadius: 3, position: 'relative', overflow: 'hidden' }}>
              <div style={{
                position: 'absolute', left: 0, top: 2, bottom: 2,
                width: `${Math.max(barPct, 1)}%`,
                background: color, opacity: 0.75, borderRadius: 2,
              }} />
              {overflow && (
                <div style={{ position: 'absolute', right: 4, top: '50%', transform: 'translateY(-50%)', fontSize: 9, color: '#fff', fontWeight: 700 }}>›</div>
              )}
            </div>
            {/* CML + ETR date */}
            <div style={{ width: 88, flexShrink: 0, fontSize: 9, color: '#6a8099', textAlign: 'right', whiteSpace: 'nowrap' }}>
              {cml > 0 ? `${cml.toLocaleString()} CML` : '—'}
              <div style={{ fontSize: 8, color: '#3a5268', marginTop: 1 }}>
                ETR {new Date(o.estimatedRestoration).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}
              </div>
            </div>
          </div>
        );
      })}

      {outages.length > faultsWithEtr.length && (
        <div style={{ fontSize: 9, color: '#3a5268', fontStyle: 'italic', marginTop: 4 }}>
          {outages.length - faultsWithEtr.length} fault{outages.length - faultsWithEtr.length > 1 ? 's' : ''} excluded — no ETR provided
        </div>
      )}

      {/* Total CML */}
      {totalCml > 0 && (
        <div style={{ marginTop: 10, paddingTop: 8, borderTop: '1px solid rgba(255,255,255,0.06)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span style={{ fontSize: 10, color: '#8899aa' }}>Total Expected CML</span>
          <span style={{ fontSize: 11, fontWeight: 700, color: '#FF9500' }}>{Math.round(totalCml).toLocaleString()}</span>
        </div>
      )}
      <div style={{ fontSize: 9, color: '#2e4460', marginTop: 4 }}>
        CML = Customer Minutes Lost · customers × minutes to ETR
      </div>
    </div>
  );
}

// ── Main OutagePanel ───────────────────────────────────────────────────────
export default function OutagePanel({ showOnMap, onToggleMap, onOutagesLoaded, onLocate }) {
  const [outages, setOutages]         = useState([]);
  const [lastUpdated, setLastUpdated] = useState(null);
  const [loading, setLoading]         = useState(false);
  const [error, setError]             = useState(null);
  const [autoRefresh, setAutoRefresh] = useState(false);
  const [expanded, setExpanded]       = useState(false);
  const [locating, setLocating]       = useState(null);
  const [showTimeline, setShowTimeline] = useState(false);
  const intervalRef                   = useRef(null);

  // ── Fetch ─────────────────────────────────────────────────────────────
  const fetchOutages = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      // Cache-bust so GitHub CDN returns fresh data on manual refresh
      const res = await fetch(`${OUTAGES_URL}?t=${Date.now()}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();

      const sepd = (data.Faults || []).filter(
        f => f.networkId === SEPD_NETWORK && f.resolved === false
      );
      setOutages(sepd);
      setLastUpdated(new Date());
      onOutagesLoaded?.(sepd);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [onOutagesLoaded]);

  useEffect(() => { fetchOutages(); }, [fetchOutages]);

  useEffect(() => {
    clearInterval(intervalRef.current);
    if (autoRefresh) intervalRef.current = setInterval(fetchOutages, 60000);
    return () => clearInterval(intervalRef.current);
  }, [autoRefresh, fetchOutages]);

  // ── Derived ───────────────────────────────────────────────────────────
  const hvFaults = outages.filter(o => o.type === 'HV');
  const lvFaults = outages.filter(o => o.type === 'LV');
  const total    = outages.length;
  const totalCustomers = outages.reduce((s, o) => s + (o.affectedCustomerCount || 0), 0);

  // ── Click row → fly map to fault ─────────────────────────────────────
  const handleLocate = useCallback((o) => {
    if (o.latitude == null) return;
    onLocate?.(o.latitude, o.longitude);
    setLocating(o.UUID);
    setTimeout(() => setLocating(null), 2000);
  }, [onLocate]);

  // ── Render ────────────────────────────────────────────────────────────
  return (
    <div className={`outage-panel ${expanded ? 'outage-panel--expanded' : ''}`}>

      {/* ── Header ─────────────────────────────────────────────────── */}
      <div className="outage-header" onClick={() => setExpanded(v => !v)}>
        <div className="outage-header-left">
          <span className={`outage-pulse ${total > 0 ? 'outage-pulse--active' : ''}`} />
          <span className="outage-title">Live Faults · SEPD</span>
          <span className="outage-counts">
            {hvFaults.length > 0 && (
              <span className="outage-badge outage-badge--hv">HV {hvFaults.length}</span>
            )}
            {lvFaults.length > 0 && (
              <span className="outage-badge outage-badge--lv">LV {lvFaults.length}</span>
            )}
            {totalCustomers > 0 && (
              <span className="outage-badge outage-badge--customers">
                👥 {totalCustomers.toLocaleString()}
              </span>
            )}
            {total === 0 && <span className="outage-badge outage-badge--ok">✓ Clear</span>}
          </span>
        </div>
        <div className="outage-header-right">
          {lastUpdated && (
            <span className="outage-time">
              {lastUpdated.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}
            </span>
          )}
          <button className="outage-refresh-btn" title="Refresh now"
            onClick={e => { e.stopPropagation(); fetchOutages(); }}>
            {loading ? '⏳' : '↺'}
          </button>
          <button
            className={`outage-map-btn ${showOnMap ? 'outage-map-btn--active' : ''}`}
            onClick={e => { e.stopPropagation(); onToggleMap(); }}>
            {showOnMap ? `🗺 On Map (${total})` : '🗺 Show Map'}
          </button>
          <button
            className={`outage-auto-btn ${autoRefresh ? 'outage-auto-btn--active' : ''}`}
            onClick={e => { e.stopPropagation(); setAutoRefresh(v => !v); }}>
            {autoRefresh ? '🟢 Auto' : '⏸ Auto'}
          </button>
          {total > 0 && (
            <button
              className={`outage-map-btn ${showTimeline ? 'outage-map-btn--active' : ''}`}
              onClick={e => { e.stopPropagation(); setShowTimeline(v => !v); }}>
              📊 CML
            </button>
          )}
          <span className="outage-chevron">{expanded ? '▲' : '▼'}</span>
        </div>
      </div>

      {/* ── Expanded body ───────────────────────────────────────────── */}
      {expanded && (
        <div className="outage-body">
          {error && (
            <div className="outage-error">⚠ {error}</div>
          )}
          {total > 0 && (
            <div className="outage-geo-note">
              📍 Click a fault to fly to its location on the map
            </div>
          )}

          {outages.map(o => {
            const color = typeColor(o.type);
            const isLocating = locating === o.UUID;
            return (
              <div
                key={o.UUID}
                className={`outage-item outage-item--active outage-item--locatable ${isLocating ? 'outage-item--locating' : ''}`}
                onClick={() => handleLocate(o)}
              >
                <div className="outage-item-top">
                  <span className="outage-job">{o.reference}</span>
                  <span className="outage-type" style={{ color }}>{o.type}</span>
                  {o.networkType && (
                    <span style={{ fontSize: 10, color: '#666', textTransform: 'capitalize' }}>
                      {o.networkType}
                    </span>
                  )}
                  <span className="outage-pin">{isLocating ? '✈' : '📍'}</span>
                  <span className="outage-elapsed">⏱ {elapsed(o.loggedAt)}</span>
                </div>

                <div className="outage-fault-name">{o.name}</div>

                {o.affectedCustomerCount > 0 && (
                  <div className="outage-customers">
                    👥 {o.affectedCustomerCount.toLocaleString()} customers affected
                  </div>
                )}

                <div className="outage-item-bottom">
                  <span>Logged: {fmtDT(o.loggedAt)}</span>
                  {o.estimatedRestoration && (
                    <span>ETR: {fmtDT(o.estimatedRestoration)}</span>
                  )}
                </div>

                {o.estimatedArrivalOnSiteTime && (
                  <div className="outage-eta">
                    🚐 Engineer ETA: {fmtDT(o.estimatedArrivalOnSiteTime)}
                  </div>
                )}
              </div>
            );
          })}

          {!error && total === 0 && !loading && (
            <div className="outage-empty">No active faults for SEPD South England.</div>
          )}

          <div className="outage-source">
            Source: robintw/sse_powercuts (SSEN live feed) · {lastUpdated
              ? `Updated ${lastUpdated.toLocaleTimeString('en-GB')}`
              : 'Loading…'}
            {autoRefresh && ' · Auto-refresh ON'}
          </div>
        </div>
      )}

      {/* ── CML Timeline (toggle independent of expand) ─────────────── */}
      {showTimeline && total > 0 && <FaultTimeline outages={outages} />}
    </div>
  );
}
