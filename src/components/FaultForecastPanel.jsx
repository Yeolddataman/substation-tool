import { useState, useEffect } from 'react';
import { fetchForecast } from '../lib/forecast';

const RAG_ICON  = { Red: '🔴', Yellow: '🟡', Green: '🟢' };
const RAG_COLOR = { Red: '#FF4444', Yellow: '#FFD700', Green: '#00E676' };

export default function FaultForecastPanel({ onForecastLoaded, onDayChange, selectedDay = 0 }) {
  const [forecast, setForecast] = useState(null);
  const [loading,  setLoading]  = useState(true);
  const [error,    setError]    = useState(null);

  useEffect(() => {
    setLoading(true);
    fetchForecast()
      .then(data => { setForecast(data); onForecastLoaded?.(data); setLoading(false); })
      .catch(e  => { setError(e.message); setLoading(false); });
  }, []);

  const ragCounts = forecast
    ? (() => {
        const c = { Red: 0, Yellow: 0, Green: 0 };
        Object.values(forecast.primaries).forEach(p => {
          const r = p.days[selectedDay]?.rag;
          if (r) c[r]++;
        });
        return c;
      })()
    : null;

  const dayLabel = forecast?.days[selectedDay]?.label ?? '';

  return (
    <div className="forecast-panel">
      <div className="forecast-header">
        <span className="forecast-title">⚡ Fault Risk Forecast</span>
        {forecast && (
          <span className="forecast-updated">
            Cached {new Date(forecast.generatedAt).toLocaleTimeString('en-GB',
              { hour: '2-digit', minute: '2-digit' })}
          </span>
        )}
      </div>

      {loading && <div className="forecast-status">Fetching weather data…</div>}
      {error   && <div className="forecast-error">⚠ {error}</div>}

      {forecast && (
        <>
          {/* Day tabs */}
          <div className="forecast-days">
            {forecast.days.map((d, i) => (
              <button
                key={i}
                className={`forecast-day-btn ${selectedDay === i ? 'forecast-day-btn--active' : ''}`}
                onClick={() => onDayChange?.(i)}
              >
                {d.label}
              </button>
            ))}
          </div>

          {/* RAG summary */}
          {ragCounts && (
            <div className="forecast-rag-summary">
              {['Red', 'Yellow', 'Green'].map(rag => (
                <span key={rag} className="forecast-rag-badge" style={{ color: RAG_COLOR[rag] }}>
                  {RAG_ICON[rag]} {ragCounts[rag]}
                </span>
              ))}
              <span className="forecast-rag-label">primaries · {dayLabel}</span>
            </div>
          )}

          <div className="forecast-note">
            Weather: Open-Meteo · Calibrated to NAFIRS fault history
          </div>
        </>
      )}
    </div>
  );
}
