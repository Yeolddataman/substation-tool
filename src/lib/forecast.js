// Module-level cache shared across all components — avoids duplicate fetches
// within the same session. TTL matches server-side 1-hour cache.
import { getToken } from './auth';

let _cache     = null;
let _cacheTime = 0;

export async function fetchForecast() {
  if (_cache && Date.now() - _cacheTime < 60 * 60 * 1000) return _cache;
  const res = await fetch('/api/fault-forecast', {
    headers: { Authorization: `Bearer ${getToken()}` },
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || `HTTP ${res.status}`);
  }
  _cache     = await res.json();
  _cacheTime = Date.now();
  return _cache;
}

export function clearForecastCache() {
  _cache     = null;
  _cacheTime = 0;
}
