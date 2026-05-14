'use client';
import { useEffect, useState, useCallback } from 'react';

type MemEntry = {
  namespace: string; key: string; value: unknown;
  writtenBy: string; writtenAt: string;
};

function fmtTime(iso: string) {
  return new Date(iso).toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

export default function MemoryPage() {
  const [entries, setEntries]   = useState<MemEntry[]>([]);
  const [loading, setLoading]   = useState(true);
  const [nsFilter, setNsFilter] = useState('all');
  const [expanded, setExpanded] = useState<string | null>(null);

  const load = useCallback(async () => {
    const data = await fetch('/api/v1/memory').then(r => r.json());
    setEntries(Array.isArray(data) ? data : []);
    setLoading(false);
  }, []);

  useEffect(() => { load(); const t = setInterval(load, 8000); return () => clearInterval(t); }, [load]);

  const namespaces = ['all', ...Array.from(new Set(entries.map(e => e.namespace)))];
  const filtered = nsFilter === 'all' ? entries : entries.filter(e => e.namespace === nsFilter);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-lg font-semibold" style={{ color: 'var(--text)' }}>Memory Store</h1>
          <p className="text-xs mt-0.5" style={{ color: 'var(--subtext)' }}>
            {loading ? 'Loading...' : `${entries.length} entries across ${namespaces.length - 1} namespaces · auto-refresh 8s`}
          </p>
        </div>
        <div className="flex gap-1 flex-wrap">
          {namespaces.map(ns => (
            <button key={ns} onClick={() => setNsFilter(ns)}
              className="text-xs px-3 py-1.5 rounded"
              style={{
                background: nsFilter === ns ? 'rgba(245,158,11,0.15)' : 'transparent',
                color: nsFilter === ns ? 'var(--accent)' : 'var(--subtext)',
                border: `1px solid ${nsFilter === ns ? 'rgba(245,158,11,0.4)' : 'var(--border)'}`,
              }}>
              {ns}
            </button>
          ))}
        </div>
      </div>

      <section className="sigma-panel overflow-hidden">
        {filtered.length === 0 ? (
          <div className="px-4 py-10 text-center text-xs" style={{ color: 'var(--muted)' }}>No memory entries</div>
        ) : (
          <table className="sigma-table">
            <thead>
              <tr><th>Namespace</th><th>Key</th><th>Written By</th><th>Time</th><th>Value</th></tr>
            </thead>
            <tbody>
              {filtered.map(e => {
                const rowKey = `${e.namespace}:${e.key}`;
                const isOpen = expanded === rowKey;
                const preview = typeof e.value === 'object'
                  ? JSON.stringify(e.value).slice(0, 60) + (JSON.stringify(e.value).length > 60 ? '…' : '')
                  : String(e.value);
                return (
                  <tr key={rowKey} style={{ verticalAlign: 'top' }}>
                    <td><span className="mono text-xs px-1.5 py-0.5 rounded" style={{ background: 'rgba(59,130,246,0.1)', color: '#60a5fa' }}>{e.namespace}</span></td>
                    <td className="mono text-xs" style={{ color: 'var(--accent)' }}>{e.key}</td>
                    <td className="mono text-xs" style={{ color: 'var(--muted)' }}>{e.writtenBy}</td>
                    <td className="mono text-xs" style={{ color: 'var(--subtext)' }}>{fmtTime(e.writtenAt)}</td>
                    <td>
                      <button onClick={() => setExpanded(isOpen ? null : rowKey)} className="text-left w-full">
                        {isOpen ? (
                          <pre className="mono text-xs p-2 rounded overflow-auto max-h-48" style={{ background: 'var(--bg)', color: 'var(--text)', whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>
                            {JSON.stringify(e.value, null, 2)}
                          </pre>
                        ) : (
                          <span className="mono text-xs" style={{ color: 'var(--subtext)' }}>{preview}</span>
                        )}
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </section>
    </div>
  );
}
