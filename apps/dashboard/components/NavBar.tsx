'use client';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';

const LINKS = [
  { href: '/approvals', label: 'Approvals' },
  { href: '/log', label: 'Runtime Log' },
  { href: '/memory', label: 'Memory' },
  { href: '/activity', label: 'Activity' },
  { href: '/risk', label: 'Risk' },
  { href: '/strategies', label: 'Strategies' },
  { href: '/journal', label: 'Journal' },
  { href: '/audit', label: 'Audit' },
  { href: '/workspace', label: 'Workspace' },
];

interface Me {
  username: string;
  email: string;
}

export default function NavBar() {
  const path = usePathname();
  const router = useRouter();
  const [pendingCount, setPendingCount] = useState(0);
  const [apiOk, setApiOk] = useState<boolean | null>(null);
  const [me, setMe] = useState<Me | null>(null);
  const [loggingOut, setLoggingOut] = useState(false);

  useEffect(() => {
    async function check() {
      try {
        const token = typeof window !== 'undefined' ? localStorage.getItem('sigma_token') : null;
        const headers: Record<string, string> = {};
        if (token) headers['Authorization'] = `Bearer ${token}`;

        const [health, pending, meRes] = await Promise.all([
          fetch('/api/health', { headers }).then(r => r.json()),
          fetch('/api/v1/approvals', { headers }).then(r => r.json()),
          fetch('/api/v1/auth/me', { credentials: 'include', headers }).then(r => r.ok ? r.json() : null),
        ]);
        setApiOk(health?.status === 'ok');
        setPendingCount(Array.isArray(pending) ? pending.length : 0);
        setMe(meRes?.user ?? null);
      } catch {
        setApiOk(false);
      }
    }
    check();
    const t = setInterval(check, 5000);
    return () => clearInterval(t);
  }, []);

  async function handleLogout() {
    setLoggingOut(true);
    try {
      const token = typeof window !== 'undefined' ? localStorage.getItem('sigma_token') : null;
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      if (token) headers['Authorization'] = `Bearer ${token}`;
      await fetch('/api/v1/auth/logout', { method: 'POST', credentials: 'include', headers });
      if (typeof window !== 'undefined') localStorage.removeItem('sigma_token');
      setMe(null);
      router.push('/login');
    } finally {
      setLoggingOut(false);
    }
  }

  return (
    <nav style={{ background: 'var(--panel)', borderBottom: '1px solid var(--border)' }}>
      <div className="max-w-screen-2xl mx-auto px-6 flex items-center gap-6 h-12">
        <div className="flex items-center gap-2 shrink-0">
          <span className="mono font-semibold text-sm" style={{ color: 'var(--accent)' }}>SIGMA</span>
          <span className="mono text-xs" style={{ color: 'var(--muted)' }}>CORE OS</span>
        </div>
        <div className="w-px h-4" style={{ background: 'var(--border)' }} />
        {LINKS.map(link => {
          const active = path.startsWith(link.href);
          return (
            <Link key={link.href} href={link.href}
              className="relative text-xs flex items-center gap-1.5 py-1 transition-colors"
              style={{ color: active ? 'var(--text)' : 'var(--muted)' }}>
              {link.label}
              {link.href === '/approvals' && pendingCount > 0 && (
                <span className="px-1.5 py-0.5 rounded text-xs mono"
                  style={{ background: 'rgba(59,130,246,0.2)', color: '#60a5fa', fontSize: 10 }}>
                  {pendingCount}
                </span>
              )}
              {active && (
                <span className="absolute bottom-0 left-0 right-0 h-0.5 rounded-full"
                  style={{ background: 'var(--accent)' }} />
              )}
            </Link>
          );
        })}
        <div className="flex-1" />
        <div className="flex items-center gap-3">
          {/* API status */}
          <div className="flex items-center gap-1.5">
            <span className={`w-1.5 h-1.5 rounded-full ${apiOk === null ? 'pulse' : ''}`}
              style={{ background: apiOk === null ? 'var(--muted)' : apiOk ? 'var(--green)' : 'var(--red)' }} />
            <span className="mono text-xs" style={{ color: 'var(--muted)' }}>
              {apiOk === null ? 'connecting' : apiOk ? 'api:ok' : 'api:down'}
            </span>
          </div>
          {/* User badge */}
          {me ? (
            <div className="flex items-center gap-2">
              <div style={{
                background: 'rgba(255,255,255,0.06)', border: '1px solid var(--border)',
                borderRadius: 6, padding: '3px 10px', display: 'flex', alignItems: 'center', gap: 6,
              }}>
                <span style={{
                  width: 20, height: 20, borderRadius: '50%',
                  background: 'var(--accent)', display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontSize: 10, fontWeight: 700, color: '#000', fontFamily: 'var(--font-mono)',
                }}>
                  {me.username.charAt(0).toUpperCase()}
                </span>
                <span className="mono text-xs" style={{ color: 'var(--text)' }}>{me.username}</span>
              </div>
              <button onClick={handleLogout} disabled={loggingOut} style={{
                background: 'transparent', border: '1px solid var(--border)',
                color: 'var(--muted)', borderRadius: 5, padding: '3px 10px',
                fontSize: 11, fontFamily: 'var(--font-mono)', cursor: 'pointer',
              }}>
                {loggingOut ? '…' : 'logout'}
              </button>
            </div>
          ) : (
            <Link href="/login" style={{
              background: 'var(--accent)', color: '#000', borderRadius: 5,
              padding: '3px 12px', fontSize: 11, fontFamily: 'var(--font-mono)',
              fontWeight: 700, textDecoration: 'none',
            }}>
              Login
            </Link>
          )}
        </div>
      </div>
    </nav>
  );
}
