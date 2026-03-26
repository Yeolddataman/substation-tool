import { useState } from 'react';
import { safetyStandards } from '../data/safetyStandards';

const TYPE_COLORS = {
  'Legislation': '#FF4444',
  'British Standard': '#00B4D8',
  'HSE Guidance': '#FF9500',
  'Industry Standard': '#7B61FF',
  'Engineering Recommendation': '#00E676',
  'Technical Specification': '#FFD700',
  'Standard / Best Practice': '#FF6B9D',
};

export default function SafetyPanel({ isOpen, onClose }) {
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState(null);
  const [filterType, setFilterType] = useState('All');

  if (!isOpen) return null;

  const types = ['All', ...new Set(safetyStandards.map((s) => s.type))];

  const filtered = safetyStandards.filter((s) => {
    const matchType = filterType === 'All' || s.type === filterType;
    const matchSearch =
      !search ||
      s.title.toLowerCase().includes(search.toLowerCase()) ||
      s.tags.some((t) => t.toLowerCase().includes(search.toLowerCase())) ||
      s.summary.toLowerCase().includes(search.toLowerCase());
    return matchType && matchSearch;
  });

  return (
    <div className="safety-panel">
      <div className="safety-panel-header">
        <div>
          <div className="safety-panel-title">UK Safety Standards</div>
          <div className="safety-panel-subtitle">{safetyStandards.length} standards loaded</div>
        </div>
        <button className="close-btn" onClick={onClose}>✕</button>
      </div>

      {/* Search */}
      <div className="safety-search-row">
        <input
          className="safety-search"
          placeholder="Search standards, tags..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>

      {/* Filter chips */}
      <div className="filter-chips">
        {types.map((t) => (
          <button
            key={t}
            className={`filter-chip ${filterType === t ? 'filter-chip--active' : ''}`}
            onClick={() => setFilterType(t)}
          >
            {t}
          </button>
        ))}
      </div>

      {/* Standards list */}
      <div className="standards-list">
        {filtered.map((std) => (
          <div
            key={std.id}
            className={`standard-card ${selected?.id === std.id ? 'standard-card--active' : ''}`}
            onClick={() => setSelected(selected?.id === std.id ? null : std)}
          >
            <div className="standard-card-header">
              <span
                className="standard-type-badge"
                style={{ background: (TYPE_COLORS[std.type] || '#888') + '22', color: TYPE_COLORS[std.type] || '#888' }}
              >
                {std.type}
              </span>
              <span className="standard-year">{std.year}</span>
            </div>
            <div className="standard-title">{std.shortTitle}</div>
            <div className="standard-full-title">{std.title}</div>

            {selected?.id === std.id && (
              <div className="standard-detail">
                <div className="standard-authority">Authority: {std.authority}</div>
                <div className="standard-scope"><strong>Scope:</strong> {std.scope}</div>
                <p className="standard-summary">{std.summary}</p>
                <div className="standard-requirements-title">Key Requirements:</div>
                <ul className="standard-requirements">
                  {std.keyRequirements.map((req, i) => (
                    <li key={i}>{req}</li>
                  ))}
                </ul>
                <div className="standard-tags">
                  {std.tags.map((tag) => (
                    <span key={tag} className="tag">{tag}</span>
                  ))}
                </div>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
