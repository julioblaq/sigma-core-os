// apps/dashboard/app/login/page.tsx
'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';

type Tab = 'login' | 'register';

export default function LoginPage() {
  const router = useRouter();
  const [tab, setTab] = useState<Tab>('login');
  const [username, setUsername] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const fieldStyle = {
    display: 'block', width: '100%',
    background: 'rgba(255,255,255,0.04)',
    border: '1px solid var(--border)',
    color: 'var(--text)',
    borderRadius: 6,
    padding: '9px 12px',
    fontSize: 14,
    fontFamily: 'var(--font-mono)',
    marginTop: 6,
    outline: 'none',
  };

  const labelStyle = {
    display: 'block',
    fontSize: 12,
    color: 'var(--muted)',
    fontFamily: 'var(--font-mono)',
    textTransform: 'uppercase' as const,
    letterSpacing: '0.05em',
    marginBottom: 2,
  };

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const res = await fetch('/api/v1/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ username: username.trim(), password }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? 'Login failed');
        return;
      }
      // Store token for Authorization header fallback
      if (data.token) localStorage.setItem('sigma_token', data.token);
      router.push('/approvals');
    } catch {
      setError('Network error — is the API running?');
    } finally {
      setLoading(false);
    }
  }

  async function handleRegister(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const res = await fetch('/api/v1/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: username.trim(), email: email.trim(), password }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? 'Registration failed');
        return;
      }
      // Switch to login after successful register
      setTab('login');
      setPassword('');
      setError('');
    } catch {
      setError('Network error — is the API running?');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div style={{
      minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center',
      background: 'var(--bg)',
    }}>
      <div style={{
        width: 380,
        background: 'var(--panel)',
        border: '1px solid var(--border)',
        borderRadius: 12,
        padding: 32,
      }}>
        {/* Logo */}
        <div style={{ textAlign: 'center', marginBottom: 28 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, marginBottom: 4 }}>
            <span className="mono font-semibold" style={{ fontSize: 20, color: 'var(--accent)' }}>SIGMA</span>
            <span className="mono" style={{ fontSize: 13, color: 'var(--muted)' }}>CORE OS</span>
          </div>
          <p style={{ color: 'var(--muted)', fontSize: 13 }}>Agentic OS — Operator Console</p>
        </div>

        {/* Tabs */}
        <div style={{ display: 'flex', gap: 0, marginBottom: 24, borderBottom: '1px solid var(--border)' }}>
          {(['login', 'register'] as Tab[]).map(t => (
            <button key={t} onClick={() => { setTab(t); setError(''); }}
              style={{
                flex: 1, background: 'none', border: 'none', cursor: 'pointer',
                padding: '8px 0', fontSize: 13, fontFamily: 'var(--font-mono)',
                color: tab === t ? 'var(--text)' : 'var(--muted)',
                borderBottom: tab === t ? '2px solid var(--accent)' : '2px solid transparent',
                marginBottom: -1,
                textTransform: 'capitalize',
              }}>
              {t}
            </button>
          ))}
        </div>

        {/* Error */}
        {error && (
          <div style={{
            background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.3)',
            borderRadius: 6, padding: '8px 12px', color: '#f87171', fontSize: 13,
            marginBottom: 16, fontFamily: 'var(--font-mono)',
          }}>
            {error}
          </div>
        )}

        {/* Login form */}
        {tab === 'login' && (
          <form onSubmit={handleLogin}>
            <div style={{ marginBottom: 16 }}>
              <label style={labelStyle}>Username</label>
              <input required style={fieldStyle} autoComplete="username"
                value={username} onChange={e => setUsername(e.target.value)}
                placeholder="your username" />
            </div>
            <div style={{ marginBottom: 24 }}>
              <label style={labelStyle}>Password</label>
              <input required type="password" style={fieldStyle} autoComplete="current-password"
                value={password} onChange={e => setPassword(e.target.value)}
                placeholder="••••••••" />
            </div>
            <button type="submit" disabled={loading} style={{
              width: '100%', background: 'var(--accent)', color: '#000',
              border: 'none', borderRadius: 7, padding: '10px 0',
              fontSize: 14, fontFamily: 'var(--font-mono)', fontWeight: 700,
              cursor: loading ? 'not-allowed' : 'pointer', opacity: loading ? 0.6 : 1,
            }}>
              {loading ? 'Signing in…' : 'Sign In'}
            </button>
          </form>
        )}

        {/* Register form */}
        {tab === 'register' && (
          <form onSubmit={handleRegister}>
            <div style={{ marginBottom: 14 }}>
              <label style={labelStyle}>Username</label>
              <input required style={fieldStyle} autoComplete="username"
                value={username} onChange={e => setUsername(e.target.value)}
                placeholder="choose a username" />
            </div>
            <div style={{ marginBottom: 14 }}>
              <label style={labelStyle}>Email</label>
              <input required type="email" style={fieldStyle} autoComplete="email"
                value={email} onChange={e => setEmail(e.target.value)}
                placeholder="you@example.com" />
            </div>
            <div style={{ marginBottom: 24 }}>
              <label style={labelStyle}>Password</label>
              <input required type="password" style={fieldStyle} autoComplete="new-password"
                value={password} onChange={e => setPassword(e.target.value)}
                placeholder="min 8 characters" />
            </div>
            <button type="submit" disabled={loading} style={{
              width: '100%', background: 'var(--accent)', color: '#000',
              border: 'none', borderRadius: 7, padding: '10px 0',
              fontSize: 14, fontFamily: 'var(--font-mono)', fontWeight: 700,
              cursor: loading ? 'not-allowed' : 'pointer', opacity: loading ? 0.6 : 1,
            }}>
              {loading ? 'Creating account…' : 'Create Account'}
            </button>
            <p style={{ textAlign: 'center', color: 'var(--muted)', fontSize: 12, marginTop: 12 }}>
              Account creation is for trusted operators only.
            </p>
          </form>
        )}
      </div>
    </div>
  );
}
