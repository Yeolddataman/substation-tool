import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { MapContainer, TileLayer, CircleMarker, Tooltip, Marker, GeoJSON, useMap } from 'react-leaflet';
import MarkerClusterGroup from 'react-leaflet-cluster';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import OutagePanel, { FaultMapMarkers } from './OutagePanel';
import { substations, getVoltageColor, getStatusColor } from '../data/substations';

// ── Exposes map.flyTo externally via a ref ─────────────────────────────────
function MapController({ flyToRef }) {
  const map = useMap();
  useEffect(() => {
    flyToRef.current = (lat, lng, zoom = 14) =>
      map.flyTo([lat, lng], zoom, { animate: true, duration: 1.2 });
  }, [map, flyToRef]);
  return null;
}

// ── Helpers ───────────────────────────────────────────────────────────────
const RAG_COLOR = { Red: '#FF4444', Amber: '#FF9500', Green: '#00E676' };
const ragColor = (rag) => RAG_COLOR[rag] || '#555';

// ── Point-in-polygon (GeoJSON coords are [lng, lat]) ─────────────────────
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
function pointInPolygon(lat, lng, polygon) {
  if (!pointInRing(lat, lng, polygon[0])) return false;
  for (let i = 1; i < polygon.length; i++) if (pointInRing(lat, lng, polygon[i])) return false;
  return true;
}
function pointInGeometry(lat, lng, geometry) {
  if (!geometry) return true;
  if (geometry.type === 'Polygon')      return pointInPolygon(lat, lng, geometry.coordinates);
  if (geometry.type === 'MultiPolygon') return geometry.coordinates.some(p => pointInPolygon(lat, lng, p));
  return true;
}

const lvIcon = (type) => L.divIcon({
  className: '',
  html: `<div style="width:6px;height:6px;border-radius:50%;background:${type === 'P' ? '#4FC3F7' : '#81C784'};border:1px solid rgba(255,255,255,0.5);"></div>`,
  iconSize: [6, 6], iconAnchor: [3, 3],
});

// ── Legend ────────────────────────────────────────────────────────────────
function Legend({ showLV, showBoundaries, showHeadroom }) {
  return (
    <div className="map-legend">
      <div className="legend-title">Voltage Level</div>
      <div className="legend-item"><span className="legend-dot" style={{ background: '#FF4444' }} />400kV GSP</div>
      <div className="legend-item"><span className="legend-dot" style={{ background: '#FF9500' }} />132kV BSP</div>
      <div className="legend-item"><span className="legend-dot" style={{ background: '#FFD700' }} />33kV Primary</div>
      <div className="legend-item"><span className="legend-dot" style={{ background: '#00E676' }} />11kV</div>
      {showLV && <>
        <div className="legend-divider" />
        <div className="legend-title">LV Substations</div>
        <div className="legend-item"><span className="legend-dot" style={{ background: '#4FC3F7' }} />Pole Mounted</div>
        <div className="legend-item"><span className="legend-dot" style={{ background: '#81C784' }} />Ground Mounted</div>
      </>}
      {showBoundaries && <>
        <div className="legend-divider" />
        <div className="legend-title">Demand RAG</div>
        <div className="legend-item"><span className="legend-dot" style={{ background: '#FF4444' }} />Red — Constrained</div>
        <div className="legend-item"><span className="legend-dot" style={{ background: '#FF9500' }} />Amber — Near limit</div>
        <div className="legend-item"><span className="legend-dot" style={{ background: '#00E676' }} />Green — Available</div>
        <div className="legend-item"><span className="legend-dot" style={{ background: '#555' }} />No data</div>
      </>}
    </div>
  );
}

// ── Static named HV/EHV markers (substations.js fallback set) ─────────────
function StaticSubstationMarkers({ onSelect, selectedId }) {
  return substations.map((sub) => {
    const voltageColor = getVoltageColor(sub.voltage);
    const statusColor  = getStatusColor(sub.status);
    const isSelected   = selectedId === sub.id;
    const radius       = sub.type === 'GSP' ? 12 : 8;
    return (
      <CircleMarker key={sub.id} center={[sub.lat, sub.lng]}
        radius={isSelected ? radius + 4 : radius}
        pathOptions={{ fillColor: voltageColor, fillOpacity: 0.85, color: isSelected ? '#fff' : statusColor, weight: isSelected ? 3 : 2 }}
        eventHandlers={{ click: () => onSelect(sub) }}>
        <Tooltip direction="top" offset={[0, -8]} opacity={0.95} className="substation-tooltip">
          <div className="tooltip-content">
            <div className="tooltip-name">{sub.name}</div>
            <div className="tooltip-meta"><span style={{ color: voltageColor }}>{sub.voltage}</span> · <span>{sub.operator}</span></div>
            <div className="tooltip-status" style={{ color: statusColor }}>● {sub.status}</div>
          </div>
        </Tooltip>
      </CircleMarker>
    );
  });
}

// ── Headroom substation markers — GSP + BSP only (Primary shown via shapefile) ──
function HeadroomMarkers({ data, onSelect, selectedId }) {
  const filtered = data.filter(s => s.type === 'GSP' || s.type === 'BSP');
  return filtered.map((sub) => {
    const isSelected = selectedId === sub.id;
    const color = sub.type === 'GSP' ? '#FF4444' : '#FF9500';
    const radius = sub.type === 'GSP' ? 11 : 8;
    const rag = ragColor(sub.demandRAG);
    return (
      <CircleMarker key={sub.id} center={[sub.lat, sub.lng]}
        radius={isSelected ? radius + 3 : radius}
        pathOptions={{ fillColor: color, fillOpacity: 0.9, color: isSelected ? '#fff' : rag, weight: isSelected ? 3 : 2 }}
        eventHandlers={{ click: () => onSelect({ ...sub, operator: 'SSEN (SEPD)', status: 'Operational', images: [], assets: [sub.transformerRating || 'See headroom data'], safetyZone: sub.voltage?.includes('400') ? 'EHV Zone A — 400kV clearance 3.7m minimum' : sub.voltage?.includes('132') ? 'HV Zone B — 132kV clearance 1.6m minimum' : 'HV Zone C — 33kV clearance 0.8m minimum' }) }}>
        <Tooltip direction="top" offset={[0, -8]} opacity={0.95} className="substation-tooltip">
          <div className="tooltip-content">
            <div className="tooltip-name">{sub.name}</div>
            <div className="tooltip-meta"><span style={{ color }}>{sub.type} · {sub.voltage}kV</span></div>
            <div className="tooltip-meta">Demand: <span style={{ color: ragColor(sub.demandRAG) }}>● {sub.demandRAG || 'N/A'}</span>  Gen: <span style={{ color: ragColor(sub.genRAG) }}>● {sub.genRAG || 'N/A'}</span></div>
          </div>
        </Tooltip>
      </CircleMarker>
    );
  });
}

// ── Primary substation boundary polygons ─────────────────────────────────
function BoundaryLayer({ data, headroomData, onSelect }) {
  // Build NRN → headroom record lookup
  const nrnMap = {};
  headroomData.forEach(s => { if (s.nrn) nrnMap[s.nrn] = s; });

  const style = useCallback((feature) => {
    const nrn = feature.properties?.PRIMARY_NRN_SPLIT;
    const sub = nrnMap[nrn];
    const fill = sub ? ragColor(sub.demandRAG) : '#555';
    return { fillColor: fill, fillOpacity: 0.15, color: fill, weight: 1, opacity: 0.5 };
  }, [headroomData]);

  const onEachFeature = useCallback((feature, layer) => {
    const nrn  = feature.properties?.PRIMARY_NRN_SPLIT;
    const sub  = nrnMap[nrn];
    const name = feature.properties?.PRIMARY_NAME_2025 || 'Unknown Primary';

    layer.bindTooltip(
      `<div style="font-size:11px;font-weight:600">${name}</div>` +
      `<div style="font-size:10px;color:#aaa">NRN: ${nrn || '—'}</div>` +
      (sub ? `<div style="font-size:10px;color:${ragColor(sub.demandRAG)}">Demand: ${sub.demandRAG || 'N/A'}</div>` : ''),
      { sticky: true, className: 'boundary-tooltip' }
    );

    // Always register click — include feature geometry so ESA filtering and
    // data quality tab work regardless of whether headroom is loaded
    layer.on('click', () => onSelect(
      sub
        ? { ...sub, geometry: feature.geometry, operator: 'SSEN (SEPD)', status: 'Operational', images: [], assets: [sub.transformerRating || 'See headroom data'], safetyZone: 'HV Zone C — 33kV clearance 0.8m minimum' }
        : { id: `PRI-NRN-${nrn}`, name, shortName: name, type: 'Primary', voltage: feature.properties?.PRIMARY_VOLTAGE_STEP || '33kV', operator: 'SSEN (SEPD)', status: 'Operational', lat: layer.getBounds().getCenter().lat, lng: layer.getBounds().getCenter().lng, nrn, region: feature.properties?.GSP_NAME || '—', description: `Primary substation ESA boundary. GSP: ${feature.properties?.GSP_NAME || '—'}, BSP: ${feature.properties?.BSP_NAME || '—'}.`, assets: ['See SSEN headroom data'], safetyZone: 'HV Zone C — 33kV clearance 0.8m minimum', images: [], geometry: feature.geometry }
    ));
  }, [headroomData]);

  // Key includes headroom record count so the GeoJSON remounts (re-runs
  // onEachFeature) when headroom data loads — prevents stale nrnMap closure.
  const geoKey = `boundaries-${headroomData.length}`;
  return <GeoJSON key={geoKey} data={data} style={style} onEachFeature={onEachFeature} />;
}

// ── Clustered LV layer ────────────────────────────────────────────────────
function LVLayer({ data, onSelect }) {
  return (
    <MarkerClusterGroup chunkedLoading chunkInterval={100} chunkDelay={50} maxClusterRadius={40}
      showCoverageOnHover={false}
      iconCreateFunction={(cluster) => {
        const count = cluster.getChildCount();
        const size = count > 1000 ? 44 : count > 100 ? 36 : 28;
        return L.divIcon({ html: `<div style="width:${size}px;height:${size}px;border-radius:50%;background:rgba(79,195,247,0.85);border:2px solid rgba(255,255,255,0.7);display:flex;align-items:center;justify-content:center;font-size:${size > 36 ? 12 : 10}px;font-weight:700;color:#0d0d0d;">${count > 999 ? Math.round(count / 1000) + 'k' : count}</div>`, className: '', iconSize: [size, size], iconAnchor: [size / 2, size / 2] });
      }}>
      {data.map((lv, i) => (
        <Marker key={i} position={[lv.lat, lv.lng]} icon={lvIcon(lv.t)}
          eventHandlers={{ click: () => onSelect({ id: `LV-${i}`, name: `LV Substation${lv.n ? ' ' + lv.n : ''}`, shortName: lv.n || 'LV', type: 'LV Distribution', voltage: '11kV/LV', operator: 'SSEN (SEPD)', lat: lv.lat, lng: lv.lng, status: 'Operational', capacityMVA: null, region: lv.a || '—', description: `${lv.t === 'P' ? 'Pole mounted' : 'Ground mounted'} 11kV/LV distribution substation. Locality: ${lv.l || '—'}. Area: ${lv.a || '—'}.`, assets: [lv.t === 'P' ? 'Pole mounted transformer' : 'Ground mounted transformer', '11kV/LV switchgear', 'LV fuse board'], safetyZone: 'LV Zone D — 0.4kV, maintain safe working distance', images: [], source: 'SSEN Open Data (CC BY 4.0)' }) }}>
          <Tooltip direction="top" offset={[0, -4]} opacity={0.9} className="substation-tooltip">
            <div className="tooltip-content">
              <div className="tooltip-name">{lv.t === 'P' ? '⚡ Pole Mounted' : '🔲 Ground Mounted'} LV</div>
              <div className="tooltip-meta"><span style={{ color: '#4FC3F7' }}>11kV/LV</span> · SSEN SEPD</div>
              {lv.l && <div className="tooltip-status" style={{ color: '#aaa' }}>📍 {lv.l}</div>}
            </div>
          </Tooltip>
        </Marker>
      ))}
    </MarkerClusterGroup>
  );
}

// ── Layer controls ────────────────────────────────────────────────────────
function LayerControls({ layers, onToggle, counts }) {
  return (
    <div className="layer-controls">
      {[
        { key: 'boundaries', label: '🗺 Primary Boundaries', activeLabel: `🗺 Boundaries ON (${counts.boundaries})` },
        { key: 'headroom',   label: '📊 Headroom Markers',  activeLabel: `📊 Headroom ON (${counts.headroom})` },
        { key: 'lv',         label: '⚡ LV Substations',    activeLabel: `⚡ LV ON (${counts.lv?.toLocaleString()})` },
      ].map(({ key, label, activeLabel }) => (
        <button key={key}
          className={`layer-btn ${layers[key] ? 'layer-btn--active' : ''}`}
          onClick={() => onToggle(key)}>
          {layers[key] ? activeLabel : label}
          {counts[key + 'Loading'] ? ' ⏳' : ''}
        </button>
      ))}
    </div>
  );
}

// ── Main MapView ──────────────────────────────────────────────────────────
export default function MapView({ onSelectSubstation, selectedSubstation, onLvCountChange }) {
  const [layers, setLayers]         = useState({ boundaries: false, headroom: false, lv: false });
  const [showFaults, setShowFaults] = useState(false);
  const [outageData, setOutageData] = useState([]);
  const flyToRef = useRef(null);
  const handleLocate = useCallback((lat, lng) => { flyToRef.current?.(lat, lng); }, []);
  const [boundaryData, setBoundary] = useState(null);
  const [headroomData, setHeadroom] = useState(null);
  const [lvData, setLV]             = useState(null);
  const [loading, setLoading]       = useState({});

  // When a primary ESA with geometry is selected, filter LV to that ESA only
  // (prevents rendering all 54k points at once — massive perf improvement)
  const filteredLvData = useMemo(() => {
    if (!lvData) return null;
    const geo = selectedSubstation?.geometry;
    if (!geo) return lvData;
    return lvData.filter(p => pointInGeometry(p.lat, p.lng, geo));
  }, [lvData, selectedSubstation]);

  // Notify parent of LV count within selected ESA (for Data Quality tab)
  useEffect(() => {
    onLvCountChange?.(layers.lv && filteredLvData ? filteredLvData.length : null);
  }, [filteredLvData, layers.lv, onLvCountChange]);

  const fetchOnce = useCallback(async (key, url, setter) => {
    setLoading(l => ({ ...l, [key]: true }));
    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setter(data);
    } catch (e) {
      console.error(`Failed to load ${key}:`, e);
      alert(`Failed to load ${key} data.`);
    } finally {
      setLoading(l => ({ ...l, [key]: false }));
    }
  }, []);

  const toggleLayer = useCallback(async (key) => {
    if (layers[key]) { setLayers(l => ({ ...l, [key]: false })); return; }
    if (key === 'boundaries' && !boundaryData) await fetchOnce('boundaries', '/sepd-primary-boundaries.geojson', setBoundary);
    if (key === 'headroom'   && !headroomData) await fetchOnce('headroom',   '/headroom-substations.json',       setHeadroom);
    if (key === 'lv'         && !lvData)       await fetchOnce('lv',         '/ssen-lv-substations.json',        setLV);
    setLayers(l => ({ ...l, [key]: true }));
  }, [layers, boundaryData, headroomData, lvData, fetchOnce]);

  const counts = {
    boundaries: boundaryData?.features?.length ?? 0,
    headroom:   headroomData?.length ?? 0,
    lv:         filteredLvData?.length ?? 0,
    boundariesLoading: loading.boundaries,
    headroomLoading:   loading.headroom,
    lvLoading:         loading.lv,
  };

  return (
    <div className="map-wrapper">
      <MapContainer center={[51.2, -1.2]} zoom={8} style={{ height: '100%', width: '100%' }} zoomControl={true} preferCanvas={false}>
        <MapController flyToRef={flyToRef} />
        <TileLayer
          url="https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png"
          attribution='&copy; <a href="https://carto.com/">CARTO</a> &copy; <a href="https://www.openstreetmap.org/">OSM</a>'
          subdomains="abcd" maxZoom={19}
        />

        {/* Primary boundary polygons — render as soon as GeoJSON is loaded (headroom optional) */}
        {layers.boundaries && boundaryData && (
          <BoundaryLayer data={boundaryData} headroomData={headroomData || []} onSelect={onSelectSubstation} />
        )}

        {/* LV clustered layer — filtered to selected ESA when one is active */}
        {layers.lv && filteredLvData && <LVLayer data={filteredLvData} onSelect={onSelectSubstation} />}

        {/* Headroom markers — real SEPD data */}
        {layers.headroom && headroomData && (
          <HeadroomMarkers data={headroomData} onSelect={onSelectSubstation} selectedId={selectedSubstation?.id} />
        )}

        {/* Static fallback markers — always visible unless headroom layer is on */}
        {!layers.headroom && (
          <StaticSubstationMarkers onSelect={onSelectSubstation} selectedId={selectedSubstation?.id} />
        )}

        {/* Live fault map markers */}
        <FaultMapMarkers outages={outageData} visible={showFaults} />
      </MapContainer>

      <Legend showLV={layers.lv} showBoundaries={layers.boundaries} showHeadroom={layers.headroom} />
      <LayerControls layers={layers} onToggle={toggleLayer} counts={counts} />
      <OutagePanel
        showOnMap={showFaults}
        onToggleMap={() => setShowFaults(v => !v)}
        onOutagesLoaded={setOutageData}
        onLocate={handleLocate}
      />
    </div>
  );
}
