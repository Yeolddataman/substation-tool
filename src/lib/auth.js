// ── Client-side auth token management ────────────────────────────────────
// Token is stored in sessionStorage so it clears automatically when the
// browser tab is closed. Never stored in localStorage or cookies.

const TOKEN_KEY = 'nia_token';
const EXP_KEY   = 'nia_token_exp';

/** Returns the stored JWT if it exists and hasn't expired, otherwise null. */
export function getToken() {
  const token = sessionStorage.getItem(TOKEN_KEY);
  const exp   = parseInt(sessionStorage.getItem(EXP_KEY) || '0', 10);
  if (!token || Date.now() > exp) {
    clearToken();
    return null;
  }
  return token;
}

/** Persists token and its expiry (server returns expiresIn in seconds). */
export function setToken(token, expiresIn) {
  sessionStorage.setItem(TOKEN_KEY, token);
  sessionStorage.setItem(EXP_KEY, String(Date.now() + expiresIn * 1000));
}

/** Clears the token — used on logout or 401 response. */
export function clearToken() {
  sessionStorage.removeItem(TOKEN_KEY);
  sessionStorage.removeItem(EXP_KEY);
}
