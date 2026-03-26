import { useState } from 'react';
import { setToken } from '../lib/auth';

export default function LoginScreen({ onAuthenticated }) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error,    setError]    = useState('');
  const [loading,  setLoading]  = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: username.trim(), password }),
      });

      const data = await res.json();

      if (!res.ok) {
        setError(data.error || 'Login failed. Please try again.');
        return;
      }

      setToken(data.token, data.expiresIn);
      onAuthenticated();
    } catch {
      setError('Unable to reach the server. Is the backend running?');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={styles.overlay}>
      <div style={styles.layout}>

        {/* ── Login card ──────────────────────────────────────────────── */}
        <div style={styles.card}>
          <div style={styles.logoRow}>
            <span style={styles.logoIcon}>⚡</span>
            <div>
              <div style={styles.logoTitle}>UK Substation Mapping Tool</div>
              <div style={styles.logoSub}>SSEN South England Power Distribution</div>
            </div>
          </div>

          <div style={styles.divider} />

          <form onSubmit={handleSubmit} style={styles.form}>
            <label style={styles.label}>Username</label>
            <input
              style={styles.input}
              type="text"
              autoComplete="username"
              autoFocus
              value={username}
              onChange={e => setUsername(e.target.value)}
              disabled={loading}
              placeholder="Enter username"
            />

            <label style={{ ...styles.label, marginTop: 16 }}>Password</label>
            <input
              style={styles.input}
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={e => setPassword(e.target.value)}
              disabled={loading}
              placeholder="Enter password"
            />

            {error && <div style={styles.error}>{error}</div>}

            <button
              type="submit"
              style={{
                ...styles.btn,
                opacity: loading || !username || !password ? 0.5 : 1,
                cursor:  loading || !username || !password ? 'not-allowed' : 'pointer',
              }}
              disabled={loading || !username || !password}
            >
              {loading ? 'Signing in…' : 'Sign In'}
            </button>
          </form>

          <div style={styles.footer}>
            Proof of Concept · SEPD licence area only
          </div>
        </div>

        {/* ── Data sources panel ──────────────────────────────────────── */}
        <div style={styles.sources}>
          <div style={styles.sourcesTitle}>Data Sources &amp; Attribution</div>
          <div style={styles.sourcesSubtitle}>
            This tool is built entirely on open datasets. Where a licence requires attribution,
            the expected credit is shown below.
          </div>

          <div style={styles.divider} />

          {DATA_SOURCES.map(group => (
            <div key={group.group} style={styles.group}>
              <div style={styles.groupLabel}>{group.group}</div>
              {group.items.map(item => (
                <div key={item.name} style={styles.sourceRow}>
                  <div style={styles.sourceTop}>
                    <span style={styles.sourceName}>{item.name}</span>
                    <span style={{ ...styles.badge, background: LICENCE_COLOR[item.licence] || '#1e3050' }}>
                      {item.licence}
                    </span>
                  </div>
                  <div style={styles.sourceProvider}>{item.provider}</div>
                  {item.attribution && (
                    <div style={styles.sourceAttr}>
                      <span style={styles.attrLabel}>Required attribution: </span>
                      {item.attribution}
                    </div>
                  )}
                  {item.note && (
                    <div style={styles.sourceNote}>{item.note}</div>
                  )}
                </div>
              ))}
            </div>
          ))}

          <div style={styles.sourcesFooter}>
            All SSEN datasets are published under CC BY 4.0 via the SSEN Open Data Portal.
            No personal data is collected or stored by this tool.
          </div>
        </div>

      </div>
    </div>
  );
}

// ── Data source definitions ─────────────────────────────────────────────────
const LICENCE_COLOR = {
  'CC BY 4.0':  'rgba(0,188,212,0.18)',
  'CC BY 3.0':  'rgba(0,150,180,0.18)',
  'OGL v3':     'rgba(0,200,120,0.18)',
  'Public':     'rgba(100,100,100,0.25)',
  'Esri Terms': 'rgba(120,80,200,0.18)',
  'MIT':        'rgba(80,160,80,0.18)',
};

const DATA_SOURCES = [
  {
    group: 'SSEN Network Data',
    items: [
      {
        name: 'Substation Locations',
        provider: 'SSEN Open Data Portal — 20260323_substation_locations_csv.csv',
        licence: 'CC BY 4.0',
        attribution: '© Scottish & Southern Electricity Networks',
        note: '267,906 records (all regions/voltages). Filtered to SEPD 11kV/LV existing substations. Deduplicated and converted from BNG to WGS84.',
      },
      {
        name: 'Network Headroom & Capacity',
        provider: 'SSEN Generation Availability & Network Capacity — headroom-dashboard-data-march-2026.csv',
        licence: 'CC BY 4.0',
        attribution: '© Scottish & Southern Electricity Networks',
        note: '1,139 rows covering GSP, BSP and Primary level for SEPD. Demand/generation RAG status, headroom MVA, fault levels, reinforcement works.',
      },
      {
        name: 'Primary Substation ESA Boundaries',
        provider: 'SSEN Network Maps Portal — sepd_primarysubstation_esa_2025.geojson',
        licence: 'CC BY 4.0',
        attribution: '© Scottish & Southern Electricity Networks',
        note: '442 MultiPolygon features defining Electricity Supply Areas. Simplified for web rendering.',
      },
      {
        name: 'NAFIRS HV Fault Records',
        provider: 'SSEN Open Data — 20260324_nafirs_hv_sepd_csv.csv',
        licence: 'CC BY 4.0',
        attribution: '© Scottish & Southern Electricity Networks',
        note: '38,551 HV fault records for SEPD. Grouped by primary NRN for fault history charts.',
      },
      {
        name: 'DFES 2025 LCT Projections',
        provider: 'SSEN Distribution Future Energy Scenarios 2025 — SEPD licence area by ESA',
        licence: 'CC BY 4.0',
        attribution: '© Scottish & Southern Electricity Networks',
        note: 'EV, heat pump, solar PV, battery storage projections to 2050. Three scenarios: Electric Engagement, Holistic Transition, Falling Behind.',
      },
    ],
  },
  {
    group: 'Live Operational Data',
    items: [
      {
        name: 'Live Power Cuts / Outages',
        provider: 'robintw/sse_powercuts (GitHub) — mirrors SSEN live outage feed',
        licence: 'Public',
        attribution: null,
        note: 'Filtered to SEPD network (com.sse.ssepd.sepd). Provides lat/lng, affected area polygons, customer counts and ETR. Updated near-real-time.',
      },
    ],
  },
  {
    group: 'Mapping & Imagery',
    items: [
      {
        name: 'Basemap — Dark Matter',
        provider: 'CartoDB / CARTO',
        licence: 'CC BY 3.0',
        attribution: '© CARTO · © OpenStreetMap contributors',
        note: 'Required attribution must appear on any published map view.',
      },
      {
        name: 'Satellite Imagery (minimap)',
        provider: 'ArcGIS World Imagery — Esri',
        licence: 'Esri Terms',
        attribution: '© Esri, Maxar, Earthstar Geographics',
        note: 'Used for substation site preview only. Not for redistribution. Review Esri terms before commercial deployment.',
      },
    ],
  },
  {
    group: 'AI & Safety Reference',
    items: [
      {
        name: 'AI Assistant',
        provider: 'Anthropic Claude API (claude-sonnet)',
        licence: 'Public',
        attribution: null,
        note: 'Users provide their own API key. No key is stored server-side. Calls are proxied through the backend for security.',
      },
      {
        name: 'UK Electrical Safety Standards',
        provider: 'HSE, BSI, ENA, UK Parliament',
        licence: 'Public',
        attribution: null,
        note: 'EaWR 1989 · BS EN 50110-1:2013 · ENA Safety Rules · HSG85 · CDM 2015 · GS(M)R 1996 · ENA TS 41-24. Embedded as AI context only — not reproduced for redistribution.',
      },
    ],
  },
];

const styles = {
  overlay: {
    position: 'fixed',
    inset: 0,
    background: '#07101e',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 99999,
    fontFamily: "'Inter', 'Segoe UI', system-ui, sans-serif",
    padding: '24px 16px',
    overflowY: 'auto',
  },
  layout: {
    display: 'flex',
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 24,
    width: '100%',
    maxWidth: 960,
  },
  card: {
    background: '#0d1929',
    border: '1px solid rgba(255,255,255,0.07)',
    borderRadius: 16,
    padding: '40px 36px 32px',
    width: '100%',
    maxWidth: 360,
    flexShrink: 0,
    boxShadow: '0 24px 64px rgba(0,0,0,0.6)',
  },
  logoRow: {
    display: 'flex',
    alignItems: 'center',
    gap: 14,
    marginBottom: 24,
  },
  logoIcon: {
    fontSize: 36,
    lineHeight: 1,
  },
  logoTitle: {
    fontSize: 16,
    fontWeight: 700,
    color: '#e8eaf0',
    letterSpacing: '-0.01em',
  },
  logoSub: {
    fontSize: 11,
    color: '#5a7299',
    marginTop: 2,
  },
  divider: {
    height: 1,
    background: 'rgba(255,255,255,0.06)',
    marginBottom: 20,
  },
  form: {
    display: 'flex',
    flexDirection: 'column',
  },
  label: {
    fontSize: 11,
    fontWeight: 600,
    color: '#8899aa',
    textTransform: 'uppercase',
    letterSpacing: '0.06em',
    marginBottom: 6,
  },
  input: {
    background: '#0a1422',
    border: '1px solid rgba(255,255,255,0.1)',
    borderRadius: 8,
    color: '#e8eaf0',
    fontSize: 14,
    padding: '10px 14px',
    outline: 'none',
    width: '100%',
    boxSizing: 'border-box',
    transition: 'border-color 0.15s',
  },
  error: {
    marginTop: 12,
    padding: '8px 12px',
    background: 'rgba(255,68,68,0.12)',
    border: '1px solid rgba(255,68,68,0.3)',
    borderRadius: 6,
    color: '#ff6b6b',
    fontSize: 12,
  },
  btn: {
    marginTop: 24,
    background: '#00bcd4',
    color: '#07101e',
    border: 'none',
    borderRadius: 8,
    padding: '12px 0',
    fontSize: 14,
    fontWeight: 700,
    width: '100%',
    transition: 'background 0.15s, opacity 0.15s',
  },
  footer: {
    marginTop: 24,
    fontSize: 11,
    color: '#2e4460',
    textAlign: 'center',
  },

  // ── Sources panel ──────────────────────────────────────────────────────
  sources: {
    background: '#0d1929',
    border: '1px solid rgba(255,255,255,0.07)',
    borderRadius: 16,
    padding: '28px 28px 24px',
    flex: 1,
    minWidth: 0,
    maxHeight: '85vh',
    overflowY: 'auto',
    boxShadow: '0 24px 64px rgba(0,0,0,0.4)',
  },
  sourcesTitle: {
    fontSize: 14,
    fontWeight: 700,
    color: '#e8eaf0',
    marginBottom: 6,
    letterSpacing: '-0.01em',
  },
  sourcesSubtitle: {
    fontSize: 11,
    color: '#5a7299',
    lineHeight: 1.6,
    marginBottom: 16,
  },
  sourcesFooter: {
    marginTop: 16,
    paddingTop: 14,
    borderTop: '1px solid rgba(255,255,255,0.05)',
    fontSize: 10,
    color: '#2e4460',
    lineHeight: 1.6,
  },
  group: {
    marginBottom: 18,
  },
  groupLabel: {
    fontSize: 10,
    fontWeight: 700,
    color: '#00bcd4',
    textTransform: 'uppercase',
    letterSpacing: '0.1em',
    marginBottom: 8,
  },
  sourceRow: {
    background: 'rgba(255,255,255,0.02)',
    border: '1px solid rgba(255,255,255,0.05)',
    borderRadius: 8,
    padding: '10px 12px',
    marginBottom: 6,
  },
  sourceTop: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    marginBottom: 3,
  },
  sourceName: {
    fontSize: 12,
    fontWeight: 600,
    color: '#c8d8e8',
    flex: 1,
  },
  badge: {
    fontSize: 10,
    fontWeight: 600,
    color: '#aac8d8',
    padding: '2px 7px',
    borderRadius: 4,
    whiteSpace: 'nowrap',
  },
  sourceProvider: {
    fontSize: 10,
    color: '#4a6278',
    marginBottom: 4,
    lineHeight: 1.5,
  },
  sourceAttr: {
    fontSize: 10,
    color: '#7a9ab0',
    marginTop: 4,
    padding: '4px 8px',
    background: 'rgba(0,188,212,0.06)',
    borderLeft: '2px solid rgba(0,188,212,0.4)',
    borderRadius: '0 4px 4px 0',
    lineHeight: 1.5,
  },
  attrLabel: {
    fontWeight: 700,
    color: '#00bcd4',
  },
  sourceNote: {
    fontSize: 10,
    color: '#3a5268',
    marginTop: 4,
    lineHeight: 1.5,
    fontStyle: 'italic',
  },
};
