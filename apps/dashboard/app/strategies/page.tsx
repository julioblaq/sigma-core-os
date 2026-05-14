'use client';
// apps/dashboard/app/strategies/page.tsx
// Slice 7b (v0.7.0): Strategy Profiles dashboard page.
// Shows strategies for a workspace with prop-firm template badges, risk params,
// create form, and archive action.
//
// Uses stub x-user-id and x-workspace-id headers — no OAuth yet.
// Role enforcement is server-side only.

import { useState, useEffect, useCallback } from 'react';

const API = '/api';

// Prop-firm template colors
const TEMPLATE_COLORS: Record<string, { bg: string; text: string }> = {
  apex: { bg: 'rgba(234,179,8,0.15)', text: '#eab308' },
  topstep: { bg: 'rgba(59,130,246,0.15)', text: '#60a5fa' },
  bulenox: { bg: 'rgba(168,85,247,0.15)', text: '#c084fc' },
  custom: { bg: 'rgba(100,116,139,0.2)', text: '#94a3b8' },
};

const STATUS_COLORS: Record<string, { bg: string; text: string }> = {
  active: { bg: 'rgba(34,197,94,0.15)', text: '#4ade80' },
  archived: { bg: 'rgba(100,116,139,0.15)', text: '#64748b' },
};

interface Strategy {
  id: string;
  workspaceId: string;
  name: string;
  slug: string;
  description?: string;
  propFirmTemplate: string;
  maxDailyDrawdown: number;
  maxPositionSize: number;
  allowedInstruments: string[];
  defaultRR: number;
  status: 'active' | 'archived';
  createdAt: string;
  updatedAt: string;
}

const PROP_FIRM_OPTIONS = ['apex', 'topstep', 'bulenox', 'custom'];
const DEFAULT_INSTRUMENTS = ['ES', 'NQ', 'MES', 'MNQ'];

function Badge({ label, style }: { label: string; style: { bg: string; text: string } }) {
  return (
    <span className="px-2 py-0.5 rounded text-xs mono font-semibold"
      style={{ background: style.bg, color: style.text }}>
      {label}
    </span>
  );
}

export default function StrategiesPage() {
  const [userId, setUserId] = useState('user-admin');
  const [workspaceId, setWorkspaceId] = useState('');
  const [strategies, setStrategies] = useState<Strategy[]>([]);
  const [includeArchived, setIncludeArchived] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  // Create form
  const [form, setForm] = useState({
    name: '',
    description: '',
    propFirmTemplate: 'apex',
    maxDailyDrawdown: '',
    maxPositionSize: '',
    defaultRR: '',
    allowedInstruments: DEFAULT_INSTRUMENTS.join(','),
  });

  const loadStrategies = useCallback(async () => {
    if (!workspaceId.trim()) return;
    setLoading(true);
    setError('');
    try {
      const res = await fetch(
        `${API}/v1/workspaces/${workspaceId}/strategies?includeArchived=${includeArchived}`,
        { headers: { 'x-user-id': userId, 'x-workspace-id': workspaceId } },
      );
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        setError(d.error ?? `HTTP ${res.status}`);
        setStrategies([]);
      } else {
        setStrategies(await res.json());
      }
    } catch {
      setError('Failed to connect to API');
    } finally {
      setLoading(false);
    }
  }, [workspaceId, userId, includeArchived]);

  useEffect(() => { loadStrategies(); }, [loadStrategies]);

  const createStrategy = async () => {
    if (!workspaceId.trim()) { setError('Workspace ID required'); return; }
    if (!form.name.trim()) { setError('Strategy name required'); return; }
    setError(''); setSuccess('');

    const body: Record<string, unknown> = {
      name: form.name.trim(),
      propFirmTemplate: form.propFirmTemplate,
    };
    if (form.description.trim()) body['description'] = form.description.trim();
    if (form.maxDailyDrawdown) body['maxDailyDrawdown'] = parseFloat(form.maxDailyDrawdown);
    if (form.maxPositionSize) body['maxPositionSize'] = parseInt(form.maxPositionSize, 10);
    if (form.defaultRR) body['defaultRR'] = parseFloat(form.defaultRR);
    if (form.allowedInstruments.trim()) {
      body['allowedInstruments'] = form.allowedInstruments.split(',').map(s => s.trim()).filter(Boolean);
    }

    try {
      const res = await fetch(`${API}/v1/workspaces/${workspaceId}/strategies`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-user-id': userId,
          'x-workspace-id': workspaceId,
        },
        body: JSON.stringify(body),
      });
      const d = await res.json();
      if (!res.ok) { setError(d.error ?? `HTTP ${res.status}`); return; }
      setSuccess(`Strategy '${d.name}' created (slug: ${d.slug})`);
      setForm({ name: '', description: '', propFirmTemplate: 'apex', maxDailyDrawdown: '', maxPositionSize: '', defaultRR: '', allowedInstruments: DEFAULT_INSTRUMENTS.join(',') });
      await loadStrategies();
    } catch { setError('Failed to create strategy'); }
  };

  const archiveStrategy = async (id: string, name: string) => {
    if (!confirm(`Archive strategy '${name}'? It will no longer be usable for trade plans.`)) return;
    setError(''); setSuccess('');
    try {
      const res = await fetch(`${API}/v1/strategies/${id}`, {
        method: 'DELETE',
        headers: { 'x-user-id': userId, 'x-workspace-id': workspaceId },
      });
      const d = await res.json();
      if (!res.ok) { setError(d.error ?? `HTTP ${res.status}`); return; }
      setSuccess(`Strategy '${name}' archived.`);
      await loadStrategies();
    } catch { setError('Failed to archive strategy'); }
  };

  return (
    <main className="max-w-screen-2xl mx-auto px-6 py-8 space-y-8">
      {/* Header */}
      <div>
        <h1 className="text-lg font-semibold" style={{ color: 'var(--text)' }}>Strategy Profiles</h1>
        <p className="text-xs mt-1" style={{ color: 'var(--muted)' }}>
          Manage prop-firm strategy profiles. Strategies feed the Risk Engine with instrument limits, position size caps, and default R:R.
        </p>
      </div>

      {/* Context controls */}
      <section className="rounded border p-4 space-y-3" style={{ background: 'var(--panel)', borderColor: 'var(--border)' }}>
        <p className="text-xs font-semibold mono uppercase" style={{ color: 'var(--muted)' }}>Workspace Context</p>
        <div className="flex gap-3 flex-wrap">
          <div className="flex flex-col gap-1">
            <label className="text-xs" style={{ color: 'var(--muted)' }}>User ID (stub)</label>
            <input value={userId} onChange={e => setUserId(e.target.value)}
              className="mono text-xs px-2 py-1 rounded border w-44"
              style={{ background: 'var(--bg)', borderColor: 'var(--border)', color: 'var(--text)' }} />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-xs" style={{ color: 'var(--muted)' }}>Workspace ID</label>
            <input value={workspaceId} onChange={e => setWorkspaceId(e.target.value)}
              placeholder="uuid..."
              className="mono text-xs px-2 py-1 rounded border w-72"
              style={{ background: 'var(--bg)', borderColor: 'var(--border)', color: 'var(--text)' }} />
          </div>
          <div className="flex items-end gap-2">
            <label className="flex items-center gap-1.5 text-xs cursor-pointer" style={{ color: 'var(--muted)' }}>
              <input type="checkbox" checked={includeArchived} onChange={e => setIncludeArchived(e.target.checked)} />
              Include archived
            </label>
            <button onClick={loadStrategies}
              className="px-3 py-1 rounded text-xs mono font-semibold"
              style={{ background: 'var(--accent)', color: '#000' }}>
              Load
            </button>
          </div>
        </div>
      </section>

      {/* Feedback */}
      {error && (
        <div className="rounded px-4 py-2 text-sm" style={{ background: 'rgba(239,68,68,0.1)', color: 'var(--red)', border: '1px solid rgba(239,68,68,0.3)' }}>
          {error}
        </div>
      )}
      {success && (
        <div className="rounded px-4 py-2 text-sm" style={{ background: 'rgba(34,197,94,0.1)', color: 'var(--green)', border: '1px solid rgba(34,197,94,0.3)' }}>
          {success}
        </div>
      )}

      {/* Create Strategy Form */}
      <section className="rounded border p-4 space-y-4" style={{ background: 'var(--panel)', borderColor: 'var(--border)' }}>
        <p className="text-xs font-semibold mono uppercase" style={{ color: 'var(--muted)' }}>Create Strategy</p>
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-3">
          <div className="flex flex-col gap-1 col-span-2 lg:col-span-1">
            <label className="text-xs" style={{ color: 'var(--muted)' }}>Name *</label>
            <input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
              placeholder="My ES Strategy"
              className="mono text-xs px-2 py-1 rounded border"
              style={{ background: 'var(--bg)', borderColor: 'var(--border)', color: 'var(--text)' }} />
          </div>
          <div className="flex flex-col gap-1 col-span-2 lg:col-span-2">
            <label className="text-xs" style={{ color: 'var(--muted)' }}>Description</label>
            <input value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
              placeholder="Short description..."
              className="mono text-xs px-2 py-1 rounded border"
              style={{ background: 'var(--bg)', borderColor: 'var(--border)', color: 'var(--text)' }} />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-xs" style={{ color: 'var(--muted)' }}>Prop Firm Template</label>
            <select value={form.propFirmTemplate} onChange={e => setForm(f => ({ ...f, propFirmTemplate: e.target.value }))}
              className="mono text-xs px-2 py-1 rounded border"
              style={{ background: 'var(--bg)', borderColor: 'var(--border)', color: 'var(--text)' }}>
              {PROP_FIRM_OPTIONS.map(t => <option key={t} value={t}>{t}</option>)}
            </select>
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-xs" style={{ color: 'var(--muted)' }}>Max Daily Drawdown % (override)</label>
            <input type="number" step="0.1" value={form.maxDailyDrawdown}
              onChange={e => setForm(f => ({ ...f, maxDailyDrawdown: e.target.value }))}
              placeholder="template default"
              className="mono text-xs px-2 py-1 rounded border"
              style={{ background: 'var(--bg)', borderColor: 'var(--border)', color: 'var(--text)' }} />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-xs" style={{ color: 'var(--muted)' }}>Max Position Size (override)</label>
            <input type="number" value={form.maxPositionSize}
              onChange={e => setForm(f => ({ ...f, maxPositionSize: e.target.value }))}
              placeholder="template default"
              className="mono text-xs px-2 py-1 rounded border"
              style={{ background: 'var(--bg)', borderColor: 'var(--border)', color: 'var(--text)' }} />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-xs" style={{ color: 'var(--muted)' }}>Default R:R (override)</label>
            <input type="number" step="0.1" value={form.defaultRR}
              onChange={e => setForm(f => ({ ...f, defaultRR: e.target.value }))}
              placeholder="template default"
              className="mono text-xs px-2 py-1 rounded border"
              style={{ background: 'var(--bg)', borderColor: 'var(--border)', color: 'var(--text)' }} />
          </div>
          <div className="flex flex-col gap-1 col-span-2">
            <label className="text-xs" style={{ color: 'var(--muted)' }}>Allowed Instruments (comma-separated)</label>
            <input value={form.allowedInstruments}
              onChange={e => setForm(f => ({ ...f, allowedInstruments: e.target.value }))}
              className="mono text-xs px-2 py-1 rounded border"
              style={{ background: 'var(--bg)', borderColor: 'var(--border)', color: 'var(--text)' }} />
          </div>
        </div>
        <button onClick={createStrategy}
          className="px-4 py-1.5 rounded text-xs mono font-semibold"
          style={{ background: 'var(--accent)', color: '#000' }}>
          Create Strategy
        </button>
        <p className="text-xs" style={{ color: 'var(--muted)' }}>
          Leave override fields blank to use template defaults. Requires admin or approver role.
        </p>
      </section>

      {/* Strategy List */}
      <section className="rounded border" style={{ background: 'var(--panel)', borderColor: 'var(--border)' }}>
        <div className="px-4 py-3 border-b flex items-center justify-between" style={{ borderColor: 'var(--border)' }}>
          <p className="text-xs font-semibold mono uppercase" style={{ color: 'var(--muted)' }}>
            Strategies — {strategies.length} {includeArchived ? '(incl. archived)' : 'active'}
          </p>
          {loading && <span className="text-xs" style={{ color: 'var(--muted)' }}>Loading...</span>}
        </div>

        {strategies.length === 0 && !loading && (
          <div className="px-4 py-8 text-center text-xs" style={{ color: 'var(--muted)' }}>
            {workspaceId ? 'No strategies found. Create one above.' : 'Enter a workspace ID to load strategies.'}
          </div>
        )}

        {strategies.length > 0 && (
          <div className="divide-y" style={{ borderColor: 'var(--border)' }}>
            {strategies.map(s => {
              const tplColor = TEMPLATE_COLORS[s.propFirmTemplate] ?? TEMPLATE_COLORS['custom'];
              const statusColor = STATUS_COLORS[s.status] ?? STATUS_COLORS['active'];
              return (
                <div key={s.id} className="px-4 py-4 space-y-2">
                  <div className="flex items-center gap-3 flex-wrap">
                    <span className="font-semibold text-sm" style={{ color: 'var(--text)' }}>{s.name}</span>
                    <Badge label={s.propFirmTemplate} style={tplColor} />
                    <Badge label={s.status} style={statusColor} />
                    <span className="mono text-xs" style={{ color: 'var(--muted)' }}>/{s.slug}</span>
                  </div>
                  {s.description && (
                    <p className="text-xs" style={{ color: 'var(--muted)' }}>{s.description}</p>
                  )}
                  <div className="flex gap-6 flex-wrap text-xs mono" style={{ color: 'var(--muted)' }}>
                    <span>Max DD: <span style={{ color: 'var(--text)' }}>{s.maxDailyDrawdown}%</span></span>
                    <span>Max Size: <span style={{ color: 'var(--text)' }}>{s.maxPositionSize} contracts</span></span>
                    <span>Default R:R: <span style={{ color: 'var(--text)' }}>{s.defaultRR}:1</span></span>
                    <span>Instruments: <span style={{ color: 'var(--accent)' }}>{s.allowedInstruments.join(', ')}</span></span>
                  </div>
                  <div className="flex items-center gap-4">
                    <span className="mono text-xs" style={{ color: 'var(--muted)' }}>id: {s.id}</span>
                    {s.status === 'active' && (
                      <button onClick={() => archiveStrategy(s.id, s.name)}
                        className="text-xs mono px-2 py-0.5 rounded border"
                        style={{ borderColor: 'rgba(239,68,68,0.4)', color: 'var(--red)', background: 'rgba(239,68,68,0.05)' }}>
                        Archive
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>

      {/* Risk Engine Integration Reference */}
      <section className="rounded border p-4" style={{ background: 'var(--panel)', borderColor: 'var(--border)' }}>
        <p className="text-xs font-semibold mono uppercase mb-3" style={{ color: 'var(--muted)' }}>
          Risk Engine Integration
        </p>
        <p className="text-xs mb-2" style={{ color: 'var(--muted)' }}>
          Pass <span className="mono" style={{ color: 'var(--accent)' }}>strategyId</span> to any risk endpoint to automatically apply strategy constraints:
        </p>
        <div className="mono text-xs space-y-1" style={{ color: 'var(--text)' }}>
          <div>POST /v1/risk/position-size — <span style={{ color: 'var(--muted)' }}>applies maxPositionSize cap + instrument check</span></div>
          <div>POST /v1/risk/tp-sl — <span style={{ color: 'var(--muted)' }}>uses defaultRR if rr not provided + instrument check</span></div>
          <div>POST /v1/risk/trade-plan — <span style={{ color: 'var(--muted)' }}>applies defaultRR, maxDailyDrawdown, maxPositionSize, allowedInstruments</span></div>
        </div>
        <p className="text-xs mt-2" style={{ color: 'var(--muted)' }}>
          Archived strategies are blocked at the API layer — they cannot be used for new trade plans.
        </p>
      </section>
    </main>
  );
}
