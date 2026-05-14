// apps/dashboard/components/ui.tsx
'use client';
import { useEffect, useCallback } from 'react';

// LoadingSpinner
export function Spinner({ size = 20 }: { size?: number }) {
  return (
    <div style={{
      width: size, height: size,
      border: `2px solid var(--border)`,
      borderTopColor: 'var(--accent)',
      borderRadius: '50%',
      display: 'inline-block',
      animation: 'spin 0.7s linear infinite',
    }} />
  );
}
// inject spin keyframe once
if (typeof document !== 'undefined') {
  if (!document.getElementById('sigma-spin-style')) {
    const s = document.createElement('style');
    s.id = 'sigma-spin-style';
    s.textContent = '@keyframes spin { to { transform: rotate(360deg); } }';
    document.head.appendChild(s);
  }
}

// LoadingOverlay
export function LoadingOverlay({ label = 'Loading…' }: { label?: string }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10, padding: 40, color: 'var(--muted)', fontSize: 13 }}>
      <Spinner />
      <span>{label}</span>
    </div>
  );
}

// SkeletonBlock
export function SkeletonBlock({ h = 20, w = '100%' }: { h?: number; w?: string | number }) {
  return <div className="skeleton" style={{ height: h, width: w, borderRadius: 4 }} />;
}

// EmptyState
export function EmptyState({ icon = '📭', title, message }: { icon?: string; title: string; message?: string }) {
  return (
    <div style={{ textAlign: 'center', padding: '48px 24px', color: 'var(--muted)' }}>
      <div style={{ fontSize: 36, marginBottom: 12 }}>{icon}</div>
      <div style={{ fontSize: 15, fontWeight: 600, color: 'var(--subtext)', marginBottom: 6 }}>{title}</div>
      {message && <div style={{ fontSize: 13 }}>{message}</div>}
    </div>
  );
}

// ErrorBanner
export function ErrorBanner({ message }: { message: string }) {
  if (!message) return null;
  return (
    <div style={{
      background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.3)',
      borderRadius: 6, padding: '10px 14px', color: '#f87171', fontSize: 13, marginBottom: 16,
    }}>
      ⚠ {message}
    </div>
  );
}

// SuccessBanner
export function SuccessBanner({ message }: { message: string }) {
  if (!message) return null;
  return (
    <div style={{
      background: 'rgba(16,185,129,0.1)', border: '1px solid rgba(16,185,129,0.3)',
      borderRadius: 6, padding: '10px 14px', color: '#34d399', fontSize: 13, marginBottom: 16,
    }}>
      ✓ {message}
    </div>
  );
}

// Modal
export function Modal({ open, onClose, title, children, width = 600 }: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: React.ReactNode;
  width?: number;
}) {
  const handleKey = useCallback((e: KeyboardEvent) => {
    if (e.key === 'Escape') onClose();
  }, [onClose]);

  useEffect(() => {
    if (open) {
      document.addEventListener('keydown', handleKey);
      document.body.style.overflow = 'hidden';
    }
    return () => {
      document.removeEventListener('keydown', handleKey);
      document.body.style.overflow = '';
    };
  }, [open, handleKey]);

  if (!open) return null;
  return (
    <div className="modal-overlay" onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal-box fade-in" style={{ maxWidth: width }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 18 }}>
          <h2 style={{ fontSize: 15, fontWeight: 700, color: 'var(--text)', fontFamily: 'var(--font-mono)' }}>{title}</h2>
          <button onClick={onClose} style={{
            background: 'transparent', border: 'none', color: 'var(--muted)',
            fontSize: 20, cursor: 'pointer', lineHeight: 1, padding: '0 4px',
          }}>×</button>
        </div>
        {children}
      </div>
    </div>
  );
}

// FilterChip — removable
export function FilterChip({ label, value, onRemove }: { label: string; value: string; onRemove: () => void }) {
  return (
    <span className="filter-chip active">
      <span style={{ color: 'var(--muted)', fontSize: 10 }}>{label}:</span>
      <span style={{ fontWeight: 600 }}>{value}</span>
      <span className="remove" onClick={onRemove} role="button" aria-label="remove filter">×</span>
    </span>
  );
}

// QuickChip — toggle button
export function QuickChip({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button className={`filter-chip${active ? ' active' : ''}`} onClick={onClick} type="button">
      {label}
    </button>
  );
}

// Badge
export function Badge({ label, bg, color, border }: { label: string; bg: string; color: string; border?: string }) {
  return (
    <span style={{
      display: 'inline-block', padding: '2px 8px', borderRadius: 4,
      fontSize: 11, fontFamily: 'var(--font-mono)', fontWeight: 600,
      background: bg, color, border: border ? `1px solid ${border}` : 'none',
    }}>
      {label}
    </span>
  );
}

// SummaryCard
export function SummaryCard({ label, value, sub, color }: { label: string; value: string; sub?: string; color?: string }) {
  return (
    <div className="summary-card">
      <div style={{ fontSize: 11, color: 'var(--muted)', fontFamily: 'var(--font-mono)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 6 }}>{label}</div>
      <div style={{ fontSize: 22, fontWeight: 700, fontFamily: 'var(--font-mono)', color: color ?? 'var(--text)' }}>{value}</div>
      {sub && <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 3 }}>{sub}</div>}
    </div>
  );
}

// Divider
export function Divider() {
  return <div style={{ height: 1, background: 'var(--border)', margin: '16px 0' }} />;
}

// Section heading
export function SectionHeading({ children }: { children: React.ReactNode }) {
  return (
    <h2 style={{ fontSize: 13, fontFamily: 'var(--font-mono)', color: 'var(--text)', fontWeight: 600, marginBottom: 16, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
      {children}
    </h2>
  );
}

// Kbd shortcut display
export function Kbd({ children }: { children: React.ReactNode }) {
  return (
    <kbd style={{
      display: 'inline-block', padding: '1px 5px', borderRadius: 3,
      border: '1px solid var(--border)', background: 'var(--panel)',
      fontSize: 11, fontFamily: 'var(--font-mono)', color: 'var(--muted)',
    }}>{children}</kbd>
  );
}
