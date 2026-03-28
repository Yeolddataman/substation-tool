import React from 'react';
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

// ── Complaints risk helpers ────────────────────────────────────────────────
function findNearestPrimary(lat, lng, complaintsData) {
  if (!complaintsData?.primaries) return null;
  // Apply cos(lat) correction to longitude delta so east/west distances are
  // not over-favoured vs north/south. At 51°N, 1° lon ≈ 70km vs 1° lat ≈ 111km.
  const cosLat = Math.cos(lat * Math.PI / 180);
  let best = null, bestDist = Infinity;
  for (const [nrn, p] of Object.entries(complaintsData.primaries)) {
    if (p.lat == null || p.lng == null) continue;
    const dLat = p.lat - lat;
    const dLng = (p.lng - lng) * cosLat;
    const d = dLat * dLat + dLng * dLng;
    if (d < bestDist) { bestDist = d; best = { nrn, ...p }; }
  }
  return best;
}

function complaintsRagColor(propensity) {
  if (propensity >= 1.20) return '#ef4444';   // red
  if (propensity >= 1.05) return '#f97316';   // amber
  if (propensity >= 0.90) return '#eab308';   // yellow
  return '#22c55e';                            // green
}

// ── 24hr Restoration Timeline ─────────────────────────────────────────────
export function FaultTimeline({ outages, complaintsData }) {
  const now = Date.now();
  const windowMs = 24 * 60 * 60 * 1000;
  const baseRate = complaintsData?.meta?.baseRate ?? 0.0025;

  const faultsWithEtr = outages
    .filter(o => o.estimatedRestoration)
    .map(o => {
      const etrMs = new Date(o.estimatedRestoration).getTime();
      const minsLeft = Math.max(0, (etrMs - now) / 60000);
      const durationHrs = minsLeft / 60;
      const customers = o.affectedCustomerCount || 0;
      const primary = complaintsData ? findNearestPrimary(o.latitude, o.longitude, complaintsData) : null;
      const propensityIndex = primary?.propensityIndex ?? 1.0;
      const expectedComplaints = customers > 0 ? Math.round(customers * durationHrs * baseRate * propensityIndex) : null;
      return {
        ...o,
        _cml: Math.round(customers * minsLeft),
        _primary: primary,
        _propensityIndex: propensityIndex,
        _expectedComplaints: expectedComplaints,
      };
    })
    .sort((a, b) => b._cml - a._cml);

  if (faultsWithEtr.length === 0) return (
    <div style={{ fontSize: 10, color: '#3a5268', fontStyle: 'italic', marginTop: 8 }}>
      No ETR data available for timeline.
    </div>
  );

  const totalCml = faultsWithEtr.reduce((sum, o) => sum + o._cml, 0);
  const totalComplaints = complaintsData
    ? faultsWithEtr.reduce((sum, o) => sum + (o._expectedComplaints ?? 0), 0)
    : null;
  const highestRiskFault = complaintsData
    ? faultsWithEtr.reduce((best, o) => (!best || (o._expectedComplaints ?? 0) > (best._expectedComplaints ?? 0) ? o : best), null)
    : null;

  return (
    <div style={{ marginTop: 14, borderTop: '1px solid rgba(255,255,255,0.06)', paddingTop: 12 }}>
      <div style={{ fontSize: 10, fontWeight: 700, color: '#8899aa', marginBottom: 10, textTransform: 'uppercase', letterSpacing: '0.07em' }}>
        24hr Restoration Timeline
      </div>

      {/* Column headers — aligned to the actual column widths */}
      <div style={{ display: 'flex', alignItems: 'flex-end', gap: 6, marginBottom: 4 }}>
        <div style={{ width: 78, flexShrink: 0 }} />
        {/* Bar track header: Now on left, +24h on right */}
        <div style={{ flex: 1, display: 'flex', justifyContent: 'space-between', fontSize: 8, color: '#3a5268', paddingLeft: 2, paddingRight: 2 }}>
          <span>Now</span>
          <span>+24h</span>
        </div>
        <div style={{ width: 88, flexShrink: 0, fontSize: 8, fontWeight: 600, color: '#6a8099', textAlign: 'right' }}>CML</div>
        {complaintsData && (
          <div style={{ width: 62, flexShrink: 0, fontSize: 8, fontWeight: 600, color: '#c084fc', textAlign: 'right' }}>Complaints</div>
        )}
      </div>

      {/* Fault rows */}
      {faultsWithEtr.map(o => {
        const color = typeColor(o.type);
        const etrMs = new Date(o.estimatedRestoration).getTime();
        const cml = o._cml;
        const barPct = Math.min(100, ((etrMs - now) / windowMs) * 100);
        const overflow = etrMs - now > windowMs;

        const ragColor = complaintsData ? complaintsRagColor(o._propensityIndex) : null;

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
              {cml > 0 ? cml.toLocaleString() : '—'}
              <div style={{ fontSize: 8, color: '#3a5268', marginTop: 1 }}>
                ETR {new Date(o.estimatedRestoration).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}
              </div>
            </div>
            {/* Complaints risk badge */}
            {complaintsData && (
              <div style={{ width: 62, flexShrink: 0, textAlign: 'right' }}>
                <div style={{
                  display: 'inline-block', fontSize: 9, fontWeight: 700,
                  color: ragColor, border: `1px solid ${ragColor}`,
                  borderRadius: 3, padding: '1px 4px', whiteSpace: 'nowrap',
                }}>
                  {o._expectedComplaints != null ? `~${o._expectedComplaints}` : '—'}
                </div>
                <div style={{ fontSize: 7, color: '#3a5268', marginTop: 1 }}>
                  {o._propensityIndex.toFixed(2)}× propensity
                </div>
              </div>
            )}
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

      {/* Complaints risk summary */}
      {complaintsData && totalComplaints != null && (
        <div style={{ marginTop: 10, paddingTop: 8, borderTop: '1px solid rgba(255,255,255,0.06)' }}>
          <div style={{ fontSize: 10, fontWeight: 700, color: '#8899aa', marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.07em' }}>
            Complaints Risk
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
            <span style={{ fontSize: 10, color: '#8899aa' }}>Est. total complaints</span>
            <span style={{ fontSize: 11, fontWeight: 700, color: '#c084fc' }}>~{totalComplaints.toLocaleString()}</span>
          </div>
          {highestRiskFault && highestRiskFault._expectedComplaints > 0 && (
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
              <span style={{ fontSize: 9, color: '#6a8099' }}>Highest risk fault</span>
              <span style={{ fontSize: 9, color: complaintsRagColor(highestRiskFault._propensityIndex), fontWeight: 600 }}>
                {highestRiskFault.reference} (~{highestRiskFault._expectedComplaints})
              </span>
            </div>
          )}
          {highestRiskFault?._primary && (
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ fontSize: 9, color: '#6a8099' }}>Nearest primary</span>
              <span style={{ fontSize: 9, color: '#8899aa' }}>{highestRiskFault._primary.name}</span>
            </div>
          )}
          {/* Methodology visual */}
          <div style={{ marginTop: 10, paddingTop: 8, borderTop: '1px solid rgba(255,255,255,0.05)' }}>
            <div style={{ fontSize: 9, fontWeight: 700, color: '#6a8099', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 6 }}>How It's Calculated</div>

            {/* Formula block */}
            <div style={{ fontFamily: 'monospace', fontSize: 9, background: 'rgba(0,0,0,0.25)', borderRadius: 5, padding: '6px 8px', marginBottom: 8, lineHeight: 1.8, color: '#4a6070' }}>
              <span style={{ color: '#c084fc' }}>complaints</span> ≈{' '}
              <span style={{ color: '#4FC3F7' }}>customers</span> ×{' '}
              <span style={{ color: '#81C784' }}>hours</span> ×{' '}
              <span style={{ color: '#FFD700' }}>{(complaintsData.meta.baseRate * 1000).toFixed(1)}<span style={{ color: '#4a6070' }}>/1000/hr</span></span> ×{' '}
              <span style={{ color: '#f97316' }}>propensity</span>
            </div>

            {/* CAM factor weights */}
            <div style={{ fontSize: 8, fontWeight: 700, color: '#6a8099', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 5 }}>Propensity Index — CAM Factors</div>
            {[
              ['Age profile',  30, '#4FC3F7', '35–54 cohort highest per Ofgem CAM'],
              ['NS-SEC class', 30, '#c084fc', 'Managerial/professional = higher propensity'],
              ['Education',    20, '#FFD700', 'Degree-level = higher propensity'],
              ['Digital conf.',20, '#81C784', 'More reporting channels available'],
            ].map(([label, pct, col, note]) => (
              <div key={label} style={{ marginBottom: 5 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <div style={{ width: 70, color: '#8899aa', fontSize: 8, flexShrink: 0 }}>{label}</div>
                  <div style={{ flex: 1, background: 'rgba(255,255,255,0.05)', borderRadius: 2, height: 6, overflow: 'hidden' }}>
                    <div style={{ width: `${pct / 0.30}%`, background: col, height: '100%', borderRadius: 2, opacity: 0.85 }} />
                  </div>
                  <div style={{ width: 24, textAlign: 'right', color: col, fontWeight: 700, fontSize: 8 }}>{pct}%</div>
                </div>
                <div style={{ fontSize: 7, color: '#3a5268', paddingLeft: 76, marginTop: 1 }}>{note}</div>
              </div>
            ))}

            {/* Propensity RAG scale */}
            <div style={{ fontSize: 8, fontWeight: 700, color: '#6a8099', textTransform: 'uppercase', letterSpacing: '0.05em', margin: '8px 0 5px' }}>Propensity Thresholds</div>
            <div style={{ display: 'flex', gap: 4 }}>
              {[
                ['Low',     '< 0.90',       '#22c55e'],
                ['Average', '0.90–1.05',    '#eab308'],
                ['Above',   '1.05–1.20',    '#f97316'],
                ['High',    '≥ 1.20',       '#ef4444'],
              ].map(([label, range, col]) => (
                <div key={label} style={{ flex: 1, textAlign: 'center', background: `${col}11`, border: `1px solid ${col}33`, borderRadius: 4, padding: '4px 2px' }}>
                  <div style={{ color: col, fontWeight: 700, fontSize: 8 }}>{label}</div>
                  <div style={{ color: '#6a8099', fontSize: 7, marginTop: 1 }}>{range}</div>
                </div>
              ))}
            </div>

            <div style={{ fontSize: 7, color: '#2e4460', marginTop: 6 }}>
              Base rate: {(complaintsData.meta.baseRate * 1000).toFixed(1)}/1000 cust/hr at propensity = 1.0 ·
              Source: Ofgem Electricity Distribution Quality of Service Report 2024 ·
              Propensity: ONS Census 2021 ({complaintsData.meta.method?.includes('LSOA') ? 'LSOA' : 'geographic proxy'})
            </div>
          </div>
        </div>
      )}

    </div>
  );
}

