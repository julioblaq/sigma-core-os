'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';

const LINKS = [
  { href: '/approvals', label: 'Approvals' },
  { href: '/log', label: 'Runtime Log' },
  { href: '/memory', label: 'Memory' },
  { href: '/activity', label: 'Activity' },
  { href: '/risk', label: 'Risk' },
  { href: '/strategies', label: 'Strategies' },
  { href: '/workspace', label: 'Workspace' },
];

export default function NavBar() {
  const path = usePathname();
  const [pendingCount, setPendingCount] = useState(0);
  const [apiOk, setApiOk] = useState<boolean | null>(null);

  useEffect(() => {
    async function check() {
      try {
        const [health, pending] = await Promise.all([
          fetch('/api/health').then(r => r.json()),
          fetch('/api/v1/approvals').then(r => r.json()),
        ]);
        setApiOk(health?.status === 'ok');
        setPendingCount(Array.isArray(pending) ? pending.length : 0);
      } catch {
        setApiOk(false);
      }
    }
    check();
    const t = setInterval(check, 5000);
    return () => clearInterval(t);
  }, []);

  return (
    <nav style={{ background: 'var(--panel)', borderBottom: '1px solid var(--border)' }}>
      <div className="max-w-screen-2xl mx-auto px-6 flex items-center gap-6 h-12">
        {/* Logo */}
        <div className="flex items-center gap-2 shrink-0">
          <span className="mono font-semibold text-sm" style={{ color: 'var(--accent)' }}>SIGMA</span>
          <span className="mono text-xs" style={{ color: 'var(--muted)' }}>CORE OS</span>
        </div>

        {/* Divider */}
        <div className="w-px h-4" style={{ background: 'var(--border)' }} />

        {/* Nav links */}
        {LINKS.map(link => {
          const active = path.startsWith(link.href);
          return (
            <Link key={link.href} href={link.href}
              className="relative text-xs flex items-center gap-1.5 py-1 transition-colors"
              style={{ color: active ? 'var(--text)' : 'var(--muted)' }}>
              {link.label}
              {link.href === '/approvals' && pendingCount > 0 && (
                <span className="px-1.5 py-0.5 rounded text-xs mono" style={{ background: 'rgba(59,130,246,0.2)', color: '#60a5fa', fontSize: 10 }}>
                  {pendingCount}
                </span>
              )}
              {active && (
                <span className="absolute bottom-0 left-0 right-0 h-0.5 rounded-full" style={{ background: 'var(--accent)' }} />
              )}
            </Link>
          );
        })}

        {/* Spacer */}
        <div className="flex-1" />

        {/* API status */}
        <div className="flex items-center gap-1.5">
          <span className={`w-1.5 h-1.5 rounded-full ${apiOk === null ? 'pulse' : ''}`}
            style={{ background: apiOk === null ? 'var(--muted)' : apiOk ? 'var(--green)' : 'var(--red)' }} />
          <span className="mono text-xs" style={{ color: 'var(--muted)' }}>
            {apiOk === null ? 'connecting' : apiOk ? 'api:ok' : 'api:down'}
          </span>
        </div>
      </div>
    </nav>
  );
}
