'use client';
import { useEffect, useState, useCallback } from 'react';
import ArtifactModal from '../../components/ArtifactModal';

type Approval = {
  id: string; agent: string; action: string; description: string;
  status: 'pending' | 'approved' | 'denied';
  createdAt: string; resolvedAt?: string; resolvedBy?: string; reason?: string;
  payload?: Record<string, unknown>;
};

const API = '/api/v1';

function Badge({ status }: { status: string }) {
  const cls = status === 'pending' ? 'badge-pending' : status === 'approved' ? 'badge-approved' : 'badge-denied';
  return <span className={`${cls} px-2 py-0.5 rounded text-xs font-mono uppercase`}>{status}</span>;
}

function fmtTime(iso: string) {
  return new Date(iso).toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

function fmtDate(iso: string) {
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

export default function ApprovalsPage() {
  const [pending, setPending]     = useState<Approval[]>([]);
  const [history, setHistory]     = useState<Approval[]>([]);
  const [loading, setLoading]     = useState(true);
  const [selected, setSelected]   = useState<Approval | null>(null);
  const [denyTarget, setDenyTarget] = useState<string | null>(null);
  const [denyReason, setDenyReason] = useState('');
  const [acting, setActing]        = useState<string | null>(null);

  const load = useCallback(async () => {
    const [p, h] = await Promise.all([
      fetch(`${API}/approvals`).then(r => r.json()),
      fetch(`${API}/approvals/history`).then(r => r.json()),
    ]);
    setPending(Array.isArray(p) ? p : []);
    setHistory(Array.isArray(h) ? h.filter((a: Approval) => a.status !== 'pending') : []);
    setLoading(false);
  }, []);

  useEffect(() => { load(); const t = setInterval(load, 5000); return () => clearInterval(t); }, [load]);

  async function approve(id: string) {
    setActing(id);
    await fetch(`${API}/approvals/${id}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ approved: true, resolvedBy: 'dashboard' }),
    });
    await load(); setActing(null);
  }

  async function deny(id: string) {
    if (!denyReason.trim()) return;
    setActing(id);
    await fetch(`${API}/approvals/${id}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ approved: false, resolvedBy: 'dashboard', reason: denyReason }),
    });
    setDenyTarget(null); setDenyReason(''); await load(); setActing(null);
  }

  return (
    <div className="space-y-8">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-lg font-semibold text-sigma-text">Approval Queue</h1>
          <p className="text-xs mt-0.5" style={{ color: 'var(--subtext)' }}>
            {loading ? 'Loading...' : `${pending.length} pending · auto-refresh 5s`}
          </p>
        </div>
        <button onClick={load} className="text-xs px-3 py-1.5 rounded border" style={{ borderColor: 'var(--border)', color: 'var(--subtext)' }}>
          Refresh
        </button>
      </div>

      {/* Pending */}
      <section className="sigma-panel overflow-hidden">
        <div className="px-4 py-3 border-b flex items-center gap-2" style={{ borderColor: 'var(--border)' }}>
          <span className="w-2 h-2 rounded-full pulse" style={{ background: 'var(--blue)' }} />
          <span className="text-xs font-medium uppercase tracking-wider" style={{ color: 'var(--subtext)' }}>
            Pending — {pending.length}
          </span>
        </div>
        {pending.length === 0 ? (
          <div className="px-4 py-10 text-center text-xs" style={{ color: 'var(--muted)' }}>No pending approvals</div>
        ) : (
          <table className="sigma-table">
            <thead>
              <tr><th>Time</th><th>Agent</th><th>Action</th><th>Description</th><th>Status</th><th></th></tr>
            </thead>
            <tbody>
              {pending.map(a => (
                <tr key={a.id}>
                  <td className="mono text-xs" style={{ color: 'var(--subtext)' }}>{fmtTime(a.createdAt)}</td>
                  <td><span className="mono text-xs px-1.5 py-0.5 rounded" style={{ background: 'rgba(245,158,11,0.1)', color: 'var(--accent)' }}>{a.agent}</span></td>
                  <td className="mono text-xs" style={{ color: 'var(--subtext)' }}>{a.action}</td>
                  <td className="text-xs max-w-xs truncate" style={{ color: 'var(--text)' }}>{a.description}</td>
                  <td><Badge status={a.status} /></td>
                  <td>
                    <div className="flex gap-2 items-center">
                      <button onClick={() => setSelected(a)} className="text-xs px-2 py-1 rounded" style={{ color: 'var(--subtext)', border: '1px solid var(--border)' }}>
                        Inspect
                      </button>
                      {denyTarget === a.id ? (
                        <div className="flex gap-1 items-center">
                          <input
                            value={denyReason}
                            onChange={e => setDenyReason(e.target.value)}
                            placeholder="Reason required..."
                            className="text-xs px-2 py-1 rounded mono"
                            style={{ background: 'var(--bg)', border: '1px solid var(--border)', color: 'var(--text)', width: 180 }}
                            onKeyDown={e => e.key === 'Enter' && deny(a.id)}
                          />
                          <button onClick={() => deny(a.id)} disabled={!denyReason.trim() || acting === a.id}
                            className="text-xs px-2 py-1 rounded disabled:opacity-40"
                            style={{ background: 'rgba(239,68,68,0.15)', color: '#f87171', border: '1px solid rgba(239,68,68,0.3)' }}>
                            Confirm
                          </button>
                          <button onClick={() => { setDenyTarget(null); setDenyReason(''); }} className="text-xs px-2 py-1 rounded" style={{ color: 'var(--muted)', border: '1px solid var(--border)' }}>✕</button>
                        </div>
                      ) : (
                        <>
                          <button onClick={() => approve(a.id)} disabled={acting === a.id}
                            className="text-xs px-2 py-1 rounded disabled:opacity-40"
                            style={{ background: 'rgba(16,185,129,0.15)', color: '#34d399', border: '1px solid rgba(16,185,129,0.3)' }}>
                            {acting === a.id ? '...' : 'Approve'}
                          </button>
                          <button onClick={() => setDenyTarget(a.id)}
                            className="text-xs px-2 py-1 rounded"
                            style={{ background: 'rgba(239,68,68,0.12)', color: '#f87171', border: '1px solid rgba(239,68,68,0.25)' }}>
                            Deny
                          </button>
                        </>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      {/* History */}
      <section className="sigma-panel overflow-hidden">
        <div className="px-4 py-3 border-b" style={{ borderColor: 'var(--border)' }}>
          <span className="text-xs font-medium uppercase tracking-wider" style={{ color: 'var(--subtext)' }}>
            History — {history.length}
          </span>
        </div>
        {history.length === 0 ? (
          <div className="px-4 py-8 text-center text-xs" style={{ color: 'var(--muted)' }}>No resolved approvals yet</div>
        ) : (
          <table className="sigma-table">
            <thead>
              <tr><th>Date</th><th>Time</th><th>Agent</th><th>Action</th><th>Description</th><th>Status</th><th>By</th><th>Reason</th><th></th></tr>
            </thead>
            <tbody>
              {history.map(a => (
                <tr key={a.id}>
                  <td className="mono text-xs" style={{ color: 'var(--muted)' }}>{fmtDate(a.createdAt)}</td>
                  <td className="mono text-xs" style={{ color: 'var(--subtext)' }}>{fmtTime(a.resolvedAt ?? a.createdAt)}</td>
                  <td><span className="mono text-xs px-1.5 py-0.5 rounded" style={{ background: 'rgba(245,158,11,0.1)', color: 'var(--accent)' }}>{a.agent}</span></td>
                  <td className="mono text-xs" style={{ color: 'var(--subtext)' }}>{a.action}</td>
                  <td className="text-xs max-w-xs truncate" style={{ color: 'var(--text)' }}>{a.description}</td>
                  <td><Badge status={a.status} /></td>
                  <td className="mono text-xs" style={{ color: 'var(--muted)' }}>{a.resolvedBy ?? '-'}</td>
                  <td className="text-xs max-w-xs truncate" style={{ color: 'var(--muted)' }}>{a.reason ?? '-'}</td>
                  <td><button onClick={() => setSelected(a)} className="text-xs px-2 py-1 rounded" style={{ color: 'var(--subtext)', border: '1px solid var(--border)' }}>Inspect</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      {/* Artifact modal */}
      {selected && <ArtifactModal approval={selected} onClose={() => setSelected(null)} />}
    </div>
  );
}
