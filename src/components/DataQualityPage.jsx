import { useState, useEffect, useMemo } from 'react';
import { sanitizeRating } from './SubstationSidebar';

const normPrimary = (name = '') =>
  name.toUpperCase().replace(/\s+(PRIMARY|GSP|BSP|SUBSTATION)$/, '').trim();

const RAG_DOT = { Red: '#FF4444', Amber: '#FF9500', Green: '#00E676' };
const ragColor = (r) => RAG_DOT[r] || '#555';

function ScoreBar({ score, total }) {
  const pct = (score / total) * 100;
  const col = score === total ? '#00E676' : score >= total - 1 ? '#FF9500' : '#FF4444';
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
      <div style={{ flex: 1, height: 5, background: 'rgba(255,255,255,0.06)', borderRadius: 3, overflow: 'hidden' }}>
        <div style={{ height: '100%', width: `${pct}%`, background: col, borderRadius: 3 }} />
      </div>
      <span style={{ fontSize: 10, color: col, fontWeight: 700, whiteSpace: 'nowrap' }}>{score}/{total}</span>
    </div>
  );
}

function Cell({ ok, label, sub }) {
  if (ok === 'loading') return <span style={{ color: '#FF9500', fontSize: 11 }}>⏳</span>;
  return (
    <span style={{ color: ok ? '#00E676' : '#3a5268', fontSize: 11, fontWeight: ok ? 600 : 400 }} title={sub}>
      {ok ? '✓' : '✗'}{label ? ` ${label}` : ''}
    </span>
  );
}

export default function DataQualityPage({ isOpen, onClose }) {
  const [headroom, setHeadroom]   = useState(null);
  const [dfes, setDfes]           = useState(null);
  const [loading, setLoading]     = useState(true);
  const [search, setSearch]       = useState('');
  const [filter, setFilter]       = useState('all');   // all | incomplete | full
  const [sortKey, setSortKey]     = useState('score');
  const [sortAsc, setSortAsc]     = useState(true);

  useEffect(() => {
    if (!isOpen || headroom) return;
    Promise.all([
      fetch('/headroom-substations.json').then(r => r.json()),
      fetch('/dfes-by-primary.json').then(r => r.json()),
    ]).then(([h, d]) => {
      setHeadroom(h);
      setDfes(d);
      setLoading(false);
    }).catch(() => setLoading(false));
  }, [isOpen]);

  const rows = useMemo(() => {
    if (!headroom || !dfes) return [];
    return headroom
      .filter(s => s.type === 'Primary')
      .map(s => {
        const hasHeadroom  = !!(s.demandRAG || s.maxDemand != null);
        const hasNafirs    = !!(s.faultsByYear && Object.keys(s.faultsByYear).length > 0);
        const hasBoundary  = !!s.nrn;
        const dfesKey      = normPrimary(s.name);
        const hasDfes      = !!dfes[dfesKey];
        const totalFaults  = hasNafirs ? Object.values(s.faultsByYear).reduce((a, b) => a + b, 0) : 0;
        const score        = [hasHeadroom, hasNafirs, hasBoundary, hasDfes].filter(Boolean).length;
        return { ...s, hasHeadroom, hasNafirs, hasBoundary, hasDfes, totalFaults, score, dfesKey };
      });
  }, [headroom, dfes]);

  const displayed = useMemo(() => {
    let r = rows;
    if (search) {
      const q = search.toLowerCase();
      r = r.filter(s => s.name?.toLowerCase().includes(q) || s.nrn?.includes(q) || s.upstreamGSP?.toLowerCase().includes(q));
    }
    if (filter === 'full')       r = r.filter(s => s.score === 4);
    if (filter === 'incomplete') r = r.filter(s => s.score < 4);
    if (filter === 'no-dfes')    r = r.filter(s => !s.hasDfes);
    if (filter === 'no-nafirs')  r = r.filter(s => !s.hasNafirs);

    r = [...r].sort((a, b) => {
      let va = a[sortKey], vb = b[sortKey];
      if (sortKey === 'name') { va = va || ''; vb = vb || ''; }
      if (va < vb) return sortAsc ? -1 : 1;
      if (va > vb) return sortAsc ?  1 : -1;
      return 0;
    });
    return r;
  }, [rows, search, filter, sortKey, sortAsc]);

  const stats = useMemo(() => {
    const total = rows.length;
    return {
      total,
      full:       rows.filter(r => r.score === 4).length,
      headroom:   rows.filter(r => r.hasHeadroom).length,
      nafirs:     rows.filter(r => r.hasNafirs).length,
      boundary:   rows.filter(r => r.hasBoundary).length,
      dfes:       rows.filter(r => r.hasDfes).length,
    };
  }, [rows]);

  const toggleSort = (key) => {
    if (sortKey === key) setSortAsc(a => !a);
    else { setSortKey(key); setSortAsc(true); }
  };

  if (!isOpen) return null;

  return (
    <div style={S.overlay}>
      <div style={S.panel}>

        {/* Header */}
        <div style={S.header}>
          <div>
            <div style={S.title}>Data Interoperability — All Primary ESAs</div>
            <div style={S.subtitle}>
              {stats.total} primary substations · {stats.full} fully linked · datasets joined via NRN, name normalisation &amp; spatial containment
            </div>
          </div>
          <button style={S.closeBtn} onClick={onClose}>✕</button>
        </div>

        {/* Summary cards */}
        {!loading && (
          <div style={S.cards}>
            {[
              { label: 'ESA Boundary',       n: stats.boundary, total: stats.total, col: '#4FC3F7' },
              { label: 'Headroom Data',       n: stats.headroom, total: stats.total, col: '#FF9500' },
              { label: 'NAFIRS Faults',       n: stats.nafirs,   total: stats.total, col: '#FFD700' },
              { label: 'DFES LCT',            n: stats.dfes,     total: stats.total, col: '#00E676' },
              { label: 'Fully Linked (4/4)',  n: stats.full,     total: stats.total, col: '#00BCD4' },
            ].map(c => (
              <div key={c.label} style={S.card}>
                <div style={{ fontSize: 20, fontWeight: 700, color: c.col }}>{c.n}</div>
                <div style={{ fontSize: 9, color: '#5a7299', marginTop: 2, textAlign: 'center' }}>{c.label}</div>
                <div style={{ height: 3, background: 'rgba(255,255,255,0.06)', borderRadius: 2, marginTop: 5, overflow: 'hidden' }}>
                  <div style={{ height: '100%', width: `${(c.n / c.total) * 100}%`, background: c.col, borderRadius: 2 }} />
                </div>
                <div style={{ fontSize: 9, color: '#3a5268', marginTop: 2, textAlign: 'right' }}>{Math.round((c.n / c.total) * 100)}%</div>
              </div>
            ))}
          </div>
        )}

        {/* Controls */}
        <div style={S.controls}>
          <input
            style={S.search}
            placeholder="Search by name, NRN or GSP…"
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
          <div style={{ display: 'flex', gap: 6 }}>
            {[
              { val: 'all',        label: 'All' },
              { val: 'full',       label: '4/4 only' },
              { val: 'incomplete', label: 'Incomplete' },
              { val: 'no-dfes',    label: 'No DFES' },
              { val: 'no-nafirs',  label: 'No NAFIRS' },
            ].map(f => (
              <button key={f.val} style={{ ...S.filterBtn, ...(filter === f.val ? S.filterBtnActive : {}) }}
                onClick={() => setFilter(f.val)}>
                {f.label}
              </button>
            ))}
          </div>
          <div style={{ fontSize: 10, color: '#3a5268', marginLeft: 'auto', alignSelf: 'center' }}>
            {displayed.length} of {stats.total} shown
          </div>
        </div>

        {/* Table */}
        {loading ? (
          <div style={{ padding: 40, textAlign: 'center', color: '#5a7299' }}>⏳ Loading datasets…</div>
        ) : (
          <div style={S.tableWrap}>
            <table style={S.table}>
              <thead>
                <tr>
                  {[
                    { key: 'name',        label: 'Primary ESA' },
                    { key: 'upstreamGSP', label: 'GSP' },
                    { key: 'upstreamBSP', label: 'BSP' },
                    { key: 'nrn',         label: 'NRN' },
                    { key: 'demandRAG',   label: 'Headroom' },
                    { key: 'hasNafirs',   label: 'NAFIRS' },
                    { key: 'hasDfes',     label: 'DFES' },
                    { key: 'hasBoundary', label: 'Boundary' },
                    { key: 'score',       label: 'Score' },
                  ].map(col => (
                    <th key={col.key} style={S.th} onClick={() => toggleSort(col.key)}>
                      {col.label} {sortKey === col.key ? (sortAsc ? '▲' : '▼') : ''}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {displayed.map(s => (
                  <tr key={s.id} style={S.tr}>
                    <td style={{ ...S.td, fontWeight: 600, color: '#c8d8e8', maxWidth: 180, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={s.name}>{s.name}</td>
                    <td style={{ ...S.td, color: '#5a7299', fontSize: 10 }}>{s.upstreamGSP || '—'}</td>
                    <td style={{ ...S.td, color: '#5a7299', fontSize: 10 }}>{s.upstreamBSP || '—'}</td>
                    <td style={{ ...S.td, fontFamily: 'monospace', fontSize: 10, color: '#4FC3F7' }}>{s.nrn || '—'}</td>
                    <td style={S.td}>
                      {s.hasHeadroom
                        ? <span style={{ color: ragColor(s.demandRAG), fontSize: 11 }}>● {s.demandRAG || '✓'}</span>
                        : <span style={{ color: '#3a5268', fontSize: 11 }}>✗</span>}
                    </td>
                    <td style={S.td}>
                      <Cell ok={s.hasNafirs} label={s.hasNafirs ? s.totalFaults : ''} sub={s.hasNafirs ? `${s.totalFaults} faults` : 'No match'} />
                    </td>
                    <td style={S.td}>
                      <Cell ok={s.hasDfes} sub={s.hasDfes ? `Key: ${s.dfesKey}` : 'No match'} />
                    </td>
                    <td style={S.td}>
                      <Cell ok={s.hasBoundary} sub={s.hasBoundary ? `NRN: ${s.nrn}` : 'No NRN match'} />
                    </td>
                    <td style={{ ...S.td, minWidth: 90 }}>
                      <ScoreBar score={s.score} total={4} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* Footer */}
        <div style={S.footer}>
          Datasets: ESA Boundary (NRN match to GeoJSON) · Headroom (SSEN March 2026) · NAFIRS HV Faults · DFES 2025 LCT Projections
          · All SSEN open data CC BY 4.0
        </div>

      </div>
    </div>
  );
}

const S = {
  overlay: {
    position: 'fixed', inset: 0, zIndex: 8000,
    background: 'rgba(5,12,25,0.96)',
    display: 'flex', alignItems: 'stretch',
    fontFamily: "'Inter','Segoe UI',system-ui,sans-serif",
  },
  panel: {
    flex: 1, display: 'flex', flexDirection: 'column',
    background: '#080f1c', overflow: 'hidden',
  },
  header: {
    display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between',
    padding: '20px 24px 16px', borderBottom: '1px solid rgba(255,255,255,0.06)',
    flexShrink: 0,
  },
  title: { fontSize: 16, fontWeight: 700, color: '#e8eaf0', letterSpacing: '-0.01em' },
  subtitle: { fontSize: 11, color: '#5a7299', marginTop: 4 },
  closeBtn: {
    background: 'none', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 6,
    color: '#5a7299', cursor: 'pointer', padding: '4px 10px', fontSize: 13, flexShrink: 0,
  },
  cards: {
    display: 'flex', gap: 10, padding: '14px 24px',
    borderBottom: '1px solid rgba(255,255,255,0.04)', flexShrink: 0,
  },
  card: {
    flex: 1, background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.06)',
    borderRadius: 8, padding: '10px 12px', display: 'flex', flexDirection: 'column', alignItems: 'center',
  },
  controls: {
    display: 'flex', gap: 10, padding: '10px 24px', alignItems: 'center',
    borderBottom: '1px solid rgba(255,255,255,0.04)', flexShrink: 0, flexWrap: 'wrap',
  },
  search: {
    background: '#0a1422', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 6,
    color: '#c8d8e8', fontSize: 12, padding: '6px 12px', outline: 'none', width: 240,
  },
  filterBtn: {
    background: 'none', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 5,
    color: '#5a7299', cursor: 'pointer', padding: '4px 10px', fontSize: 11,
  },
  filterBtnActive: {
    background: 'rgba(0,188,212,0.12)', border: '1px solid #00bcd4', color: '#00bcd4',
  },
  tableWrap: { flex: 1, overflowY: 'auto', overflowX: 'auto' },
  table: { width: '100%', borderCollapse: 'collapse', fontSize: 11 },
  th: {
    padding: '8px 12px', textAlign: 'left', fontSize: 10, fontWeight: 700,
    color: '#5a7299', textTransform: 'uppercase', letterSpacing: '0.06em',
    borderBottom: '1px solid rgba(255,255,255,0.06)', cursor: 'pointer',
    position: 'sticky', top: 0, background: '#080f1c', whiteSpace: 'nowrap',
    userSelect: 'none',
  },
  tr: { borderBottom: '1px solid rgba(255,255,255,0.03)' },
  td: { padding: '7px 12px', color: '#8899aa', verticalAlign: 'middle' },
  footer: {
    padding: '8px 24px', fontSize: 9, color: '#2e4460',
    borderTop: '1px solid rgba(255,255,255,0.04)', flexShrink: 0,
  },
};
