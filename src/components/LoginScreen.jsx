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
      <div style={styles.card}>
        {/* Logo */}
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
    </div>
  );
}

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
  },
  card: {
    background: '#0d1929',
    border: '1px solid rgba(255,255,255,0.07)',
    borderRadius: 16,
    padding: '40px 36px 32px',
    width: '100%',
    maxWidth: 380,
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
    marginBottom: 28,
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
};
