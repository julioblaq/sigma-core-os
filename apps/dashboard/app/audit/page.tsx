// apps/dashboard/app/audit/page.tsx
'use client';
import { useState } from 'react';

// OutcomeEntry shape returned by GET /v1/log/search
interface OutcomeEntry {
  id: string;
  approvalId: string;
  taskType: string;
  agent: string;
  outcome: 'approved' | 'denied';
  resolvedBy?: string;
  reason?: string;
  loggedAt: string;
}

interface SearchState {
  agent: string;
  action: string;
  status: string;
  from: string;
  to: string;
  limit: string;
}

const BADGE: Record<string, { bg: string; color: string }> = {
  approved: { bg: 'rgba(34,197,94,0.15)', color: '#4ade80' },
  denied:   { bg: 'rgba(239,68,68,0.15)',  color: '#f87171' },
};

const AGENT_COLOR: Record<string, string> = {
  'sigma-bot': '#60a5fa',
  'sigma-dev': '#f59e0b',
  'sigma-risk': '#a78bfa',
};

function agentColor(agent: string): string {
  return AGENT_COLOR[agent] ?? 'var(--muted)';
}

export default function AuditPage() {
  const [form, setForm] = useState<SearchState>({
    agent: '', action: '', status: '', from: '', to: '', limit: '100',
  });
  const [results, setResults] = useState<OutcomeEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [searched, setSearched] = useState(false);
  const [error, setError] = useState('');

  function handleChange(field: keyof SearchState, value: string) {
    setForm(f => ({ ...f, [field]: value }));
  }

  async function runSearch(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError('');
    setSearched(false);
    try {
      const params = new URLSearchParams();
      if (form.agent)  params.set('agent',  form.agent.trim());
      if (form.action) params.set('action', form.action.trim());
      if (form.status) params.set('status', form.status);
      if (form.from)   params.set('from',   form.from);
      if (form.to)     params.set('to',     form.to);
      if (form.limit)  params.set('limit',  form.limit);

      const res = await fetch(`/api/v1/log/search?${params.toString()}`);
      if (!res.ok) throw new Error(`API error ${res.status}`);
      const data: OutcomeEntry[] = await res.json();
      setResults(data);
      setSearched(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setLoading(false);
    }
  }

  function clearForm() {
    setForm({ agent: '', action: '', status: '', from: '', to: '', limit: '100' });
    setResults([]);
    setSearched(false);
    setError('');
  }

  const fieldStyle = {
    background: 'var(--panel)',
    border: '1px solid var(--border)',
    color: 'var(--text)',
    borderRadius: 6,
    padding: '6px 10px',
    fontSize: 13,
    fontFamily: 'var(--font-mono)',
    width: '100%',
  };

  const labelStyle = {
    display: 'block',
    fontSize: 11,
    color: 'var(--muted)',
    marginBottom: 4,
    fontFamily: 'var(--font-mono)',
    textTransform: 'uppercase' as const,
    letterSpacing: '0.05em',
  };

  return (
    <div className="p-6 max-w-screen-2xl mx-auto">
      <div style={{ marginBottom: 24 }}>
        <h1 className="mono font-semibold text-lg" style={{ color: 'var(--text)' }}>Audit Log Search</h1>
        <p style={{ color: 'var(--muted)', fontSize: 13, marginTop: 4 }}>
          Read-only search of the outcome_log. Filter by agent, action, status, or date range.
        </p>
      </div>

      {/* Search form */}
      <form onSubmit={runSearch} style={{
        background: 'var(--panel)', border: '1px solid var(--border)',
        borderRadius: 8, padding: 20, marginBottom: 24,
      }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: 16, marginBottom: 16 }}>
          <div>
            <label style={labelStyle}>Agent</label>
            <input style={fieldStyle} placeholder="sigma-bot" value={form.agent}
              onChange={e => handleChange('agent', e.target.value)} />
          </div>
          <div>
            <label style={labelStyle}>Action</label>
            <input style={fieldStyle} placeholder="trade_plan" value={form.action}
              onChange={e => handleChange('action', e.target.value)} />
          </div>
          <div>
            <label style={labelStyle}>Status</label>
            <select style={fieldStyle} value={form.status}
              onChange={e => handleChange('status', e.target.value)}>
              <option value="">All</option>
              <option value="approved">approved</option>
              <option value="denied">denied</option>
            </select>
          </div>
          <div>
            <label style={labelStyle}>From (ISO date)</label>
            <input style={fieldStyle} type="datetime-local" value={form.from}
              onChange={e => handleChange('from', e.target.value ? new Date(e.target.value).toISOString() : '')} />
          </div>
          <div>
            <label style={labelStyle}>To (ISO date)</label>
            <input style={fieldStyle} type="datetime-local" value={form.to}
              onChange={e => handleChange('to', e.target.value ? new Date(e.target.value).toISOString() : '')} />
          </div>
          <div>
            <label style={labelStyle}>Limit</label>
            <input style={fieldStyle} type="number" min="1" max="500" placeholder="100"
              value={form.limit} onChange={e => handleChange('limit', e.target.value)} />
          </div>
        </div>

        <div style={{ display: 'flex', gap: 10 }}>
          <button type="submit" disabled={loading} style={{
            background: 'var(--accent)', color: '#000', border: 'none', borderRadius: 6,
            padding: '7px 18px', fontSize: 13, fontFamily: 'var(--font-mono)',
            fontWeight: 600, cursor: loading ? 'not-allowed' : 'pointer', opacity: loading ? 0.6 : 1,
          }}>
            {loading ? 'Searching…' : 'Search'}
          </button>
          <button type="button" onClick={clearForm} style={{
            background: 'transparent', color: 'var(--muted)', border: '1px solid var(--border)',
            borderRadius: 6, padding: '7px 14px', fontSize: 13, fontFamily: 'var(--font-mono)', cursor: 'pointer',
          }}>
            Clear
          </button>
        </div>
      </form>

      {/* Error */}
      {error && (
        <div style={{ background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.3)',
          borderRadius: 6, padding: '10px 14px', color: '#f87171', fontSize: 13, marginBottom: 16 }}>
          {error}
        </div>
      )}

      {/* Results */}
      {searched && (
        <div>
          <div style={{ color: 'var(--muted)', fontSize: 12, marginBottom: 12, fontFamily: 'var(--font-mono)' }}>
            {results.length} result{results.length !== 1 ? 's' : ''}
          </div>

          {results.length === 0 ? (
            <div style={{ color: 'var(--muted)', fontSize: 13, textAlign: 'center', padding: 40 }}>
              No entries found for these filters.
            </div>
          ) : (
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                <thead>
                  <tr style={{ borderBottom: '1px solid var(--border)' }}>
                    {['Timestamp', 'Agent', 'Action', 'Status', 'Approval ID', 'Resolved By', 'Reason'].map(h => (
                      <th key={h} style={{
                        textAlign: 'left', padding: '8px 12px', color: 'var(--muted)',
                        fontFamily: 'var(--font-mono)', fontSize: 11,
                        textTransform: 'uppercase', letterSpacing: '0.05em', whiteSpace: 'nowrap',
                      }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {results.map((entry, idx) => {
                    const badge = BADGE[entry.outcome] ?? { bg: 'rgba(100,100,100,0.15)', color: 'var(--muted)' };
                    const isEven = idx % 2 === 0;
                    return (
                      <tr key={entry.id} style={{
                        background: isEven ? 'transparent' : 'rgba(255,255,255,0.02)',
                        borderBottom: '1px solid var(--border)',
                      }}>
                        <td style={{ padding: '8px 12px', fontFamily: 'var(--font-mono)', whiteSpace: 'nowrap', color: 'var(--muted)', fontSize: 12 }}>
                          {new Date(entry.loggedAt).toLocaleString()}
                        </td>
                        <td style={{ padding: '8px 12px', fontFamily: 'var(--font-mono)', whiteSpace: 'nowrap' }}>
                          <span style={{
                            background: 'rgba(0,0,0,0.3)', borderRadius: 4,
                            padding: '2px 8px', color: agentColor(entry.agent), fontSize: 12,
                          }}>
                            {entry.agent}
                          </span>
                        </td>
                        <td style={{ padding: '8px 12px', fontFamily: 'var(--font-mono)', color: 'var(--text)', whiteSpace: 'nowrap' }}>
                          {entry.taskType}
                        </td>
                        <td style={{ padding: '8px 12px' }}>
                          <span style={{
                            background: badge.bg, color: badge.color,
                            borderRadius: 4, padding: '2px 8px',
                            fontFamily: 'var(--font-mono)', fontSize: 11,
                          }}>
                            {entry.outcome}
                          </span>
                        </td>
                        <td style={{ padding: '8px 12px', fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--muted)', maxWidth: 200 }}>
                          <span title={entry.approvalId} style={{ cursor: 'default' }}>
                            {entry.approvalId.slice(0, 8)}…
                          </span>
                        </td>
                        <td style={{ padding: '8px 12px', fontFamily: 'var(--font-mono)', fontSize: 12, color: 'var(--muted)' }}>
                          {entry.resolvedBy ?? '—'}
                        </td>
                        <td style={{ padding: '8px 12px', fontSize: 12, color: 'var(--muted)', maxWidth: 240 }}>
                          {entry.reason ?? '—'}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
