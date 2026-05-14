'use client';
// apps/dashboard/app/journal/page.tsx
// Slice 7c (v0.7.0): Trade Journal dashboard page.
// Timeline view of journal entries with strategy filter, open/closed badges,
// close trade form, and summary cards.

import { useState, useEffect, useCallback } from 'react';

const API = '/api';

type JournalOutcome = 'open' | 'win' | 'loss' | 'scratch';
type JournalSide = 'long' | 'short';

interface JournalEntry {
  id: string;
  workspaceId: string;
  strategyId?: string;
  symbol: string;
  side: JournalSide;
  entryPrice: number;
  exitPrice?: number;
  contracts: number;
  pnlDollars?: number;
  outcome: JournalOutcome;
  notes?: string;
  tags: string[];
  openedAt: string;
  closedAt?: string;
}

interface JournalSummary {
  totalTrades: number;
  openTrades: number;
  closedTrades: number;
  wins: number;
  losses: number;
  scratches: number;
  winRate: number;
  totalPnl: number;
  averagePnl: number;
}

const OUTCOME_STYLES: Record<JournalOutcome, { bg: string; text: string; label: string }> = {
  open:    { bg: 'rgba(59,130,246,0.15)', text: '#60a5fa', label: 'OPEN' },
  win:     { bg: 'rgba(34,197,94,0.15)',  text: '#4ade80', label: 'WIN' },
  loss:    { bg: 'rgba(239,68,68,0.15)',  text: '#f87171', label: 'LOSS' },
  scratch: { bg: 'rgba(100,116,139,0.15)', text: '#94a3b8', label: 'SCRATCH' },
};

const SIDE_STYLES: Record<JournalSide, { text: string }> = {
  long:  { text: '#4ade80' },
  short: { text: '#f87171' },
};

function Badge({ label, style }: { label: string; style: { bg: string; text: string } }) {
  return (
    <span className="px-2 py-0.5 rounded text-xs mono font-semibold"
      style={{ background: style.bg, color: style.text }}>
      {label}
    </span>
  );
}

function PnlDisplay({ pnl }: { pnl: number | undefined }) {
  if (pnl === undefined) return <span style={{ color: 'var(--muted)' }}>—</span>;
  const color = pnl > 0 ? '#4ade80' : pnl < 0 ? '#f87171' : '#94a3b8';
  return <span style={{ color }} className="mono font-semibold">{pnl >= 0 ? '+' : ''}${pnl.toFixed(2)}</span>;
}

export default function JournalPage() {
  const [userId, setUserId] = useState('user-admin');
  const [workspaceId, setWorkspaceId] = useState('');
  const [strategyFilter, setStrategyFilter] = useState('');
  const [entries, setEntries] = useState<JournalEntry[]>([]);
  const [summary, setSummary] = useState<JournalSummary | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  // New entry form
  const [newForm, setNewForm] = useState({
    symbol: 'ES', side: 'long' as JournalSide,
    entryPrice: '', contracts: '1',
    strategyId: '', notes: '', tags: '',
  });

  // Close form
  const [closeId, setCloseId] = useState('');
  const [closeForm, setCloseForm] = useState({
    exitPrice: '', pnlDollars: '', outcome: 'win' as Exclude<JournalOutcome, 'open'>, notes: '',
  });

  const headers = useCallback(() => ({
    'Content-Type': 'application/json',
    'x-user-id': userId,
    'x-workspace-id': workspaceId,
  }), [userId, workspaceId]);

  const load = useCallback(async () => {
    if (!workspaceId.trim()) return;
    setLoading(true); setError('');
    try {
      const url = strategyFilter
        ? `${API}/v1/workspaces/${workspaceId}/journal?strategyId=${strategyFilter}`
        : `${API}/v1/workspaces/${workspaceId}/journal`;
      const [entriesRes, summaryRes] = await Promise.all([
        fetch(url, { headers: headers() }),
        fetch(`${API}/v1/workspaces/${workspaceId}/journal/summary${strategyFilter ? '?strategyId=' + strategyFilter : ''}`, { headers: headers() }),
      ]);
      if (!entriesRes.ok) { setError((await entriesRes.json().catch(() => ({}))).error ?? `HTTP ${entriesRes.status}`); return; }
      setEntries(await entriesRes.json());
      if (summaryRes.ok) setSummary(await summaryRes.json());
    } catch { setError('Failed to connect to API'); }
    finally { setLoading(false); }
  }, [workspaceId, strategyFilter, headers]);

  useEffect(() => { load(); }, [load]);

  const createEntry = async () => {
    if (!workspaceId.trim()) { setError('Workspace ID required'); return; }
    if (!newForm.entryPrice) { setError('Entry price required'); return; }
    setError(''); setSuccess('');
    const body: Record<string, unknown> = {
      symbol: newForm.symbol.toUpperCase(),
      side: newForm.side,
      entryPrice: parseFloat(newForm.entryPrice),
      contracts: parseInt(newForm.contracts, 10),
    };
    if (newForm.strategyId.trim()) body['strategyId'] = newForm.strategyId.trim();
    if (newForm.notes.trim()) body['notes'] = newForm.notes.trim();
    if (newForm.tags.trim()) body['tags'] = newForm.tags.split(',').map(t => t.trim()).filter(Boolean);

    try {
      const res = await fetch(`${API}/v1/workspaces/${workspaceId}/journal`, {
        method: 'POST', headers: headers(), body: JSON.stringify(body),
      });
      const d = await res.json();
      if (!res.ok) { setError(d.error ?? `HTTP ${res.status}`); return; }
      setSuccess(`Trade logged: ${d.symbol} ${d.side.toUpperCase()} ${d.contracts}x @ ${d.entryPrice}`);
      setNewForm({ symbol: 'ES', side: 'long', entryPrice: '', contracts: '1', strategyId: '', notes: '', tags: '' });
      await load();
    } catch { setError('Failed to create journal entry'); }
  };

  const closeTrade = async () => {
    if (!closeId.trim()) { setError('Entry ID required'); return; }
    if (!closeForm.exitPrice || !closeForm.pnlDollars) { setError('Exit price and P&L required'); return; }
    setError(''); setSuccess('');
    try {
      const res = await fetch(`${API}/v1/journal/${closeId}/close`, {
        method: 'POST', headers: headers(),
        body: JSON.stringify({
          exitPrice: parseFloat(closeForm.exitPrice),
          pnlDollars: parseFloat(closeForm.pnlDollars),
          outcome: closeForm.outcome,
          notes: closeForm.notes || undefined,
        }),
      });
      const d = await res.json();
      if (!res.ok) { setError(d.error ?? `HTTP ${res.status}`); return; }
      setSuccess(`Trade closed: ${d.outcome.toUpperCase()} | P&L: ${d.pnlDollars >= 0 ? '+' : ''}$${d.pnlDollars}`);
      setCloseId(''); setCloseForm({ exitPrice: '', pnlDollars: '', outcome: 'win', notes: '' });
      await load();
    } catch { setError('Failed to close trade'); }
  };

  return (
    <main className="max-w-screen-2xl mx-auto px-6 py-8 space-y-8">
      {/* Header */}
      <div>
        <h1 className="text-lg font-semibold" style={{ color: 'var(--text)' }}>Trade Journal</h1>
        <p className="text-xs mt-1" style={{ color: 'var(--muted)' }}>
          Timeline of trades per workspace. Filter by strategy. Log open trades and close them with P&amp;L.
        </p>
      </div>

      {/* Context controls */}
      <section className="rounded border p-4 space-y-3" style={{ background: 'var(--panel)', borderColor: 'var(--border)' }}>
        <p className="text-xs font-semibold mono uppercase" style={{ color: 'var(--muted)' }}>Workspace Context</p>
        <div className="flex gap-3 flex-wrap items-end">
          <div className="flex flex-col gap-1">
            <label className="text-xs" style={{ color: 'var(--muted)' }}>User ID (stub)</label>
            <input value={userId} onChange={e => setUserId(e.target.value)}
              className="mono text-xs px-2 py-1 rounded border w-40"
              style={{ background: 'var(--bg)', borderColor: 'var(--border)', color: 'var(--text)' }} />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-xs" style={{ color: 'var(--muted)' }}>Workspace ID</label>
            <input value={workspaceId} onChange={e => setWorkspaceId(e.target.value)} placeholder="uuid..."
              className="mono text-xs px-2 py-1 rounded border w-64"
              style={{ background: 'var(--bg)', borderColor: 'var(--border)', color: 'var(--text)' }} />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-xs" style={{ color: 'var(--muted)' }}>Filter by Strategy ID</label>
            <input value={strategyFilter} onChange={e => setStrategyFilter(e.target.value)} placeholder="uuid or empty..."
              className="mono text-xs px-2 py-1 rounded border w-56"
              style={{ background: 'var(--bg)', borderColor: 'var(--border)', color: 'var(--text)' }} />
          </div>
          <button onClick={load} className="px-3 py-1 rounded text-xs mono font-semibold"
            style={{ background: 'var(--accent)', color: '#000' }}>Load</button>
        </div>
      </section>

      {/* Feedback */}
      {error && <div className="rounded px-4 py-2 text-sm" style={{ background: 'rgba(239,68,68,0.1)', color: 'var(--red)', border: '1px solid rgba(239,68,68,0.3)' }}>{error}</div>}
      {success && <div className="rounded px-4 py-2 text-sm" style={{ background: 'rgba(34,197,94,0.1)', color: 'var(--green)', border: '1px solid rgba(34,197,94,0.3)' }}>{success}</div>}

      {/* Summary Cards */}
      {summary && (
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
          {[
            { label: 'Total Trades', value: summary.totalTrades },
            { label: 'Open', value: summary.openTrades, color: '#60a5fa' },
            { label: 'Win Rate', value: summary.totalTrades > 0 ? `${summary.winRate}%` : '—' },
            { label: 'Total P&L', value: summary.totalPnl, pnl: true },
            { label: 'Avg P&L', value: summary.averagePnl, pnl: true },
          ].map(c => (
            <div key={c.label} className="rounded border p-3 space-y-1" style={{ background: 'var(--panel)', borderColor: 'var(--border)' }}>
              <p className="text-xs" style={{ color: 'var(--muted)' }}>{c.label}</p>
              <p className="text-lg mono font-bold" style={{ color: c.color ?? (c.pnl ? ((c.value as number) >= 0 ? '#4ade80' : '#f87171') : 'var(--text)') }}>
                {c.pnl ? `${(c.value as number) >= 0 ? '+' : ''}$${(c.value as number).toFixed(2)}` : c.value}
              </p>
            </div>
          ))}
        </div>
      )}

      {/* Log New Trade */}
      <section className="rounded border p-4 space-y-3" style={{ background: 'var(--panel)', borderColor: 'var(--border)' }}>
        <p className="text-xs font-semibold mono uppercase" style={{ color: 'var(--muted)' }}>Log New Trade</p>
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          {[
            { label: 'Symbol', key: 'symbol', placeholder: 'ES' },
            { label: 'Entry Price', key: 'entryPrice', placeholder: '5000', type: 'number' },
            { label: 'Contracts', key: 'contracts', placeholder: '1', type: 'number' },
            { label: 'Strategy ID (opt)', key: 'strategyId', placeholder: 'uuid...' },
          ].map(f => (
            <div key={f.key} className="flex flex-col gap-1">
              <label className="text-xs" style={{ color: 'var(--muted)' }}>{f.label}</label>
              <input type={f.type ?? 'text'} placeholder={f.placeholder}
                value={(newForm as Record<string, string>)[f.key]}
                onChange={e => setNewForm(p => ({ ...p, [f.key]: e.target.value }))}
                className="mono text-xs px-2 py-1 rounded border"
                style={{ background: 'var(--bg)', borderColor: 'var(--border)', color: 'var(--text)' }} />
            </div>
          ))}
          <div className="flex flex-col gap-1">
            <label className="text-xs" style={{ color: 'var(--muted)' }}>Side</label>
            <select value={newForm.side} onChange={e => setNewForm(p => ({ ...p, side: e.target.value as JournalSide }))}
              className="mono text-xs px-2 py-1 rounded border"
              style={{ background: 'var(--bg)', borderColor: 'var(--border)', color: 'var(--text)' }}>
              <option value="long">Long</option>
              <option value="short">Short</option>
            </select>
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-xs" style={{ color: 'var(--muted)' }}>Notes</label>
            <input value={newForm.notes} onChange={e => setNewForm(p => ({ ...p, notes: e.target.value }))} placeholder="Optional..."
              className="mono text-xs px-2 py-1 rounded border"
              style={{ background: 'var(--bg)', borderColor: 'var(--border)', color: 'var(--text)' }} />
          </div>
          <div className="flex flex-col gap-1 col-span-2">
            <label className="text-xs" style={{ color: 'var(--muted)' }}>Tags (comma-separated)</label>
            <input value={newForm.tags} onChange={e => setNewForm(p => ({ ...p, tags: e.target.value }))} placeholder="momentum, breakout..."
              className="mono text-xs px-2 py-1 rounded border"
              style={{ background: 'var(--bg)', borderColor: 'var(--border)', color: 'var(--text)' }} />
          </div>
        </div>
        <button onClick={createEntry} className="px-4 py-1.5 rounded text-xs mono font-semibold"
          style={{ background: 'var(--accent)', color: '#000' }}>Log Trade</button>
      </section>

      {/* Close Trade */}
      <section className="rounded border p-4 space-y-3" style={{ background: 'var(--panel)', borderColor: 'var(--border)' }}>
        <p className="text-xs font-semibold mono uppercase" style={{ color: 'var(--muted)' }}>Close Trade</p>
        <div className="flex gap-3 flex-wrap items-end">
          {[
            { label: 'Entry ID', key: 'id', placeholder: 'uuid...', state: closeId, set: setCloseId, wide: true },
          ].map(f => (
            <div key={f.key} className="flex flex-col gap-1">
              <label className="text-xs" style={{ color: 'var(--muted)' }}>{f.label}</label>
              <input value={f.state} onChange={e => f.set(e.target.value)} placeholder={f.placeholder}
                className={`mono text-xs px-2 py-1 rounded border ${f.wide ? 'w-72' : 'w-32'}`}
                style={{ background: 'var(--bg)', borderColor: 'var(--border)', color: 'var(--text)' }} />
            </div>
          ))}
          {[
            { label: 'Exit Price', key: 'exitPrice', type: 'number' },
            { label: 'P&L ($)', key: 'pnlDollars', type: 'number' },
          ].map(f => (
            <div key={f.key} className="flex flex-col gap-1">
              <label className="text-xs" style={{ color: 'var(--muted)' }}>{f.label}</label>
              <input type={f.type} value={(closeForm as Record<string, string>)[f.key]}
                onChange={e => setCloseForm(p => ({ ...p, [f.key]: e.target.value }))}
                className="mono text-xs px-2 py-1 rounded border w-28"
                style={{ background: 'var(--bg)', borderColor: 'var(--border)', color: 'var(--text)' }} />
            </div>
          ))}
          <div className="flex flex-col gap-1">
            <label className="text-xs" style={{ color: 'var(--muted)' }}>Outcome</label>
            <select value={closeForm.outcome} onChange={e => setCloseForm(p => ({ ...p, outcome: e.target.value as Exclude<JournalOutcome, 'open'> }))}
              className="mono text-xs px-2 py-1 rounded border"
              style={{ background: 'var(--bg)', borderColor: 'var(--border)', color: 'var(--text)' }}>
              <option value="win">Win</option>
              <option value="loss">Loss</option>
              <option value="scratch">Scratch</option>
            </select>
          </div>
          <button onClick={closeTrade} className="px-3 py-1 rounded text-xs mono font-semibold"
            style={{ background: 'rgba(239,68,68,0.15)', color: 'var(--red)', border: '1px solid rgba(239,68,68,0.3)' }}>
            Close Trade
          </button>
        </div>
      </section>

      {/* Timeline */}
      <section className="rounded border" style={{ background: 'var(--panel)', borderColor: 'var(--border)' }}>
        <div className="px-4 py-3 border-b flex items-center justify-between" style={{ borderColor: 'var(--border)' }}>
          <p className="text-xs font-semibold mono uppercase" style={{ color: 'var(--muted)' }}>
            Journal — {entries.length} {strategyFilter ? 'filtered' : 'total'}
          </p>
          {loading && <span className="text-xs" style={{ color: 'var(--muted)' }}>Loading...</span>}
        </div>

        {entries.length === 0 && !loading && (
          <div className="px-4 py-8 text-center text-xs" style={{ color: 'var(--muted)' }}>
            {workspaceId ? 'No journal entries. Log a trade above.' : 'Enter a workspace ID to load the journal.'}
          </div>
        )}

        <div className="divide-y" style={{ borderColor: 'var(--border)' }}>
          {entries.map(e => {
            const os = OUTCOME_STYLES[e.outcome];
            const ss = SIDE_STYLES[e.side];
            return (
              <div key={e.id} className="px-4 py-3 space-y-1.5">
                <div className="flex items-center gap-3 flex-wrap">
                  <span className="font-semibold text-sm mono" style={{ color: 'var(--text)' }}>{e.symbol}</span>
                  <span className="text-xs mono font-semibold" style={{ color: ss.text }}>{e.side.toUpperCase()}</span>
                  <span className="text-xs mono" style={{ color: 'var(--muted)' }}>{e.contracts}x @ {e.entryPrice}</span>
                  <Badge label={os.label} style={{ bg: os.bg, text: os.text }} />
                  <PnlDisplay pnl={e.pnlDollars} />
                  {e.tags.length > 0 && e.tags.map(t => (
                    <span key={t} className="text-xs mono px-1.5 py-0.5 rounded"
                      style={{ background: 'rgba(100,116,139,0.15)', color: 'var(--muted)' }}>{t}</span>
                  ))}
                </div>
                {e.notes && <p className="text-xs" style={{ color: 'var(--muted)' }}>{e.notes}</p>}
                <div className="flex gap-4 text-xs mono" style={{ color: 'var(--muted)' }}>
                  <span>opened: {new Date(e.openedAt).toLocaleString()}</span>
                  {e.closedAt && <span>closed: {new Date(e.closedAt).toLocaleString()}</span>}
                  {e.exitPrice && <span>exit: {e.exitPrice}</span>}
                  <span style={{ color: 'rgba(100,116,139,0.6)', fontSize: 10 }}>id: {e.id}</span>
                </div>
              </div>
            );
          })}
        </div>
      </section>
    </main>
  );
}
