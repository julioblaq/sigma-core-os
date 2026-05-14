'use client';
import { useEffect, useState, useCallback } from 'react';

type LogEntry = {
  id: string; approvalId: string; taskType: string;
  agent: string; outcome: 'approved' | 'denied';
  resolvedBy?: string; reason?: string; loggedAt: string;
};

function Badge({ outcome }: { outcome: string }) {
  const cls = outcome === 'approved' ? 'badge-approved' : 'badge-denied';
  return <span className={`${cls} px-2 py-0.5 rounded text-xs font-mono uppercase`}>{outcome}</span>;
}

function fmtTime(iso: string) {
  return new Date(iso).toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

export default function LogPage() {
  const [entries, setEntries] = useState<LogEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter]   = useState<'all' | 'approved' | 'denied'>('all');

  const load = useCallback(async () => {
    const data = await fetch('/api/v1/log').then(r => r.json());
    setEntries(Array.isArray(data) ? data : []);
    setLoading(false);
  }, []);

  useEffect(() => { load(); const t = setInterval(load, 5000); return () => clearInterval(t); }, [load]);

  const filtered = filter === 'all' ? entries : entries.filter(e => e.outcome === filter);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-lg font-semibold" style={{ color: 'var(--text)' }}>Runtime Log</h1>
          <p className="text-xs mt-0.5" style={{ color: 'var(--subtext)' }}>
            {loading ? 'Loading...' : `${entries.length} entries · append-only · auto-refresh 5s`}
          </p>
        </div>
        <div className="flex gap-1">
          {(['all', 'approved', 'denied'] as const).map(f => (
            <button key={f} onClick={() => setFilter(f)}
              className="text-xs px-3 py-1.5 rounded capitalize"
              style={{
                background: filter === f ? 'rgba(245,158,11,0.15)' : 'transparent',
                color: filter === f ? 'var(--accent)' : 'var(--subtext)',
                border: `1px solid ${filter === f ? 'rgba(245,158,11,0.4)' : 'var(--border)'}`,
              }}>
              {f}
            </button>
          ))}
        </div>
      </div>

      <section className="sigma-panel overflow-hidden">
        {filtered.length === 0 ? (
          <div className="px-4 py-10 text-center text-xs" style={{ color: 'var(--muted)' }}>No log entries</div>
        ) : (
          <table className="sigma-table">
            <thead>
              <tr><th>Time</th><th>Agent</th><th>Task Type</th><th>Outcome</th><th>Resolved By</th><th>Reason</th><th>Approval ID</th></tr>
            </thead>
            <tbody>
              {filtered.map(e => (
                <tr key={e.id}>
                  <td className="mono text-xs" style={{ color: 'var(--subtext)' }}>{fmtTime(e.loggedAt)}</td>
                  <td><span className="mono text-xs px-1.5 py-0.5 rounded" style={{ background: 'rgba(245,158,11,0.1)', color: 'var(--accent)' }}>{e.agent}</span></td>
                  <td className="mono text-xs" style={{ color: 'var(--subtext)' }}>{e.taskType}</td>
                  <td><Badge outcome={e.outcome} /></td>
                  <td className="mono text-xs" style={{ color: 'var(--muted)' }}>{e.resolvedBy ?? '-'}</td>
                  <td className="text-xs" style={{ color: 'var(--muted)' }}>{e.reason ?? '-'}</td>
                  <td className="mono text-xs" style={{ color: 'var(--muted)', maxWidth: 140, overflow: 'hidden', textOverflow: 'ellipsis' }}>{e.approvalId.slice(0, 8)}…</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </div>
  );
}
