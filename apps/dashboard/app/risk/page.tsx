'use client';
import { useEffect, useState, useCallback } from 'react';

// Contract spec from API
interface ContractSpec {
  symbol: string; name: string; tickSize: number;
  tickValue: number; pointValue: number; exchange: string;
}

interface TradePlan {
  symbol: string; side: string; entry: number; stop: number; target: number;
  contracts: number; stopPoints: number; targetPoints: number; rr: number;
  riskDollars: number; riskPercent: number; pointValue: number;
  warnings: string[]; blocked: boolean; blockReasons: string[];
}

const API = '/api/v1';

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      <label className="text-xs font-medium uppercase tracking-wider" style={{ color: 'var(--subtext)' }}>{label}</label>
      {children}
    </div>
  );
}

function Input({ value, onChange, type = 'text', placeholder = '' }: {
  value: string; onChange: (v: string) => void; type?: string; placeholder?: string;
}) {
  return (
    <input
      type={type} value={value} onChange={e => onChange(e.target.value)}
      placeholder={placeholder}
      className="text-sm px-3 py-2 rounded mono"
      style={{ background: 'var(--bg)', border: '1px solid var(--border)', color: 'var(--text)', width: '100%' }}
    />
  );
}

function Select({ value, onChange, options }: {
  value: string; onChange: (v: string) => void;
  options: { value: string; label: string }[];
}) {
  return (
    <select value={value} onChange={e => onChange(e.target.value)}
      className="text-sm px-3 py-2 rounded mono"
      style={{ background: 'var(--bg)', border: '1px solid var(--border)', color: 'var(--text)', width: '100%' }}>
      {options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
    </select>
  );
}

function StatCard({ label, value, sub, accent }: { label: string; value: string; sub?: string; accent?: string }) {
  return (
    <div className="sigma-panel p-4">
      <div className="text-xs uppercase tracking-wider mb-1" style={{ color: 'var(--subtext)' }}>{label}</div>
      <div className="text-xl font-semibold mono" style={{ color: accent ?? 'var(--text)' }}>{value}</div>
      {sub && <div className="text-xs mt-0.5" style={{ color: 'var(--muted)' }}>{sub}</div>}
    </div>
  );
}

export default function RiskPage() {
  const [contracts, setContracts]   = useState<ContractSpec[]>([]);
  const [symbol, setSymbol]         = useState('MES');
  const [side, setSide]             = useState<'long' | 'short'>('long');
  const [entry, setEntry]           = useState('5000');
  const [stopPoints, setStopPoints] = useState('4');
  const [rr, setRr]                 = useState('2');
  const [accountSize, setAccountSize] = useState('10000');
  const [riskDollars, setRiskDollars] = useState('200');
  const [dailyLoss, setDailyLoss]   = useState('');
  const [maxDailyPct, setMaxDailyPct] = useState('2');
  const [plan, setPlan]             = useState<TradePlan | null>(null);
  const [approvalId, setApprovalId] = useState<string | null>(null);
  const [loading, setLoading]       = useState(false);
  const [error, setError]           = useState<string | null>(null);

  useEffect(() => {
    fetch(`${API}/risk/contracts`).then(r => r.json()).then(setContracts).catch(() => {});
  }, []);

  const selectedSpec = contracts.find(c => c.symbol === symbol);

  const calculate = useCallback(async () => {
    setLoading(true); setError(null); setPlan(null); setApprovalId(null);
    try {
      const body: Record<string, unknown> = {
        symbol, side,
        entry:      parseFloat(entry),
        stopPoints: parseFloat(stopPoints),
        rrRatio:    parseFloat(rr),
        accountSize: parseFloat(accountSize),
        riskDollars: parseFloat(riskDollars),
        submittedBy: 'dashboard',
      };
      if (dailyLoss) {
        body.dailyLossDollars = parseFloat(dailyLoss);
        body.maxDailyLossPct  = parseFloat(maxDailyPct);
      }

      const res  = await fetch(`${API}/risk/trade-plan`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      setPlan(data.plan);
      if (data.approvalId) setApprovalId(data.approvalId);
      if (!res.ok && !data.plan) setError(data.error ?? 'Calculation failed');
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [symbol, side, entry, stopPoints, rr, accountSize, riskDollars, dailyLoss, maxDailyPct]);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-lg font-semibold" style={{ color: 'var(--text)' }}>Risk Engine</h1>
        <p className="text-xs mt-0.5" style={{ color: 'var(--subtext)' }}>
          Deterministic position sizing — no LLM math. All plans require human approval.
        </p>
      </div>

      {/* Contract specs strip */}
      {contracts.length > 0 && (
        <div className="grid grid-cols-4 gap-3">
          {contracts.map(c => (
            <button key={c.symbol} onClick={() => setSymbol(c.symbol)}
              className="sigma-panel p-3 text-left transition-all"
              style={{ borderColor: symbol === c.symbol ? 'var(--blue)' : 'var(--border)' }}>
              <div className="mono text-sm font-semibold" style={{ color: symbol === c.symbol ? 'var(--blue)' : 'var(--text)' }}>{c.symbol}</div>
              <div className="text-xs mt-0.5" style={{ color: 'var(--muted)' }}>{c.name}</div>
              <div className="text-xs mt-1 mono" style={{ color: 'var(--subtext)' }}>
                undefined/pt · tick undefined
              </div>
            </button>
          ))}
        </div>
      )}

      {/* Input form */}
      <div className="sigma-panel p-5 grid grid-cols-3 gap-4">
        <Field label="Symbol">
          <Select value={symbol} onChange={setSymbol}
            options={(contracts.length ? contracts : [{ symbol: 'MES' }, { symbol: 'MNQ' }, { symbol: 'ES' }, { symbol: 'NQ' }] as ContractSpec[])
              .map(c => ({ value: c.symbol, label: c.symbol }))} />
        </Field>
        <Field label="Side">
          <Select value={side} onChange={v => setSide(v as 'long' | 'short')}
            options={[{ value: 'long', label: 'LONG' }, { value: 'short', label: 'SHORT' }]} />
        </Field>
        <Field label="Entry Price">
          <Input value={entry} onChange={setEntry} type="number" placeholder="5000" />
        </Field>
        <Field label="Stop Distance (pts)">
          <Input value={stopPoints} onChange={setStopPoints} type="number" placeholder="4" />
        </Field>
        <Field label="R:R Ratio">
          <Input value={rr} onChange={setRr} type="number" placeholder="2" />
        </Field>
        <Field label="Account Size ($)">
          <Input value={accountSize} onChange={setAccountSize} type="number" placeholder="10000" />
        </Field>
        <Field label="Risk Dollars ($)">
          <Input value={riskDollars} onChange={setRiskDollars} type="number" placeholder="200" />
        </Field>
        <Field label="Today's Loss ($) — optional">
          <Input value={dailyLoss} onChange={setDailyLoss} type="number" placeholder="0" />
        </Field>
        <Field label="Max Daily Loss (%)">
          <Input value={maxDailyPct} onChange={setMaxDailyPct} type="number" placeholder="2" />
        </Field>
      </div>

      {/* Calculate button */}
      <button onClick={calculate} disabled={loading}
        className="px-6 py-2.5 rounded text-sm font-medium disabled:opacity-40 transition-all"
        style={{ background: 'var(--blue)', color: '#fff' }}>
        {loading ? 'Calculating...' : 'Calculate & Submit for Approval'}
      </button>

      {/* Error */}
      {error && (
        <div className="sigma-panel p-4 text-sm" style={{ color: '#f87171', borderColor: 'rgba(239,68,68,0.3)' }}>
          {error}
        </div>
      )}

      {/* Results */}
      {plan && (
        <div className="space-y-4">
          {/* Blocked warning */}
          {plan.blocked && (
            <div className="sigma-panel p-4" style={{ borderColor: 'rgba(239,68,68,0.4)', background: 'rgba(239,68,68,0.05)' }}>
              <div className="text-sm font-medium" style={{ color: '#f87171' }}>Trade Plan Blocked</div>
              {plan.blockReasons.map((r, i) => (
                <div key={i} className="text-xs mt-1" style={{ color: '#fca5a5' }}>{r}</div>
              ))}
            </div>
          )}

          {/* Approval queued */}
          {approvalId && !plan.blocked && (
            <div className="sigma-panel p-4" style={{ borderColor: 'rgba(16,185,129,0.4)', background: 'rgba(16,185,129,0.05)' }}>
              <div className="text-sm font-medium" style={{ color: '#34d399' }}>Queued for Approval</div>
              <div className="text-xs mt-1 mono" style={{ color: 'var(--muted)' }}>ID: {approvalId}</div>
            </div>
          )}

          {/* Stat cards */}
          <div className="grid grid-cols-4 gap-3">
            <StatCard label="Contracts" value={String(plan.contracts)}
              sub={`${plan.symbol} ${plan.side.toUpperCase()}`} accent="var(--blue)" />
            <StatCard label="Dollar Risk" value={`$${plan.riskDollars.toFixed(2)}`}
              sub={`${plan.riskPercent.toFixed(2)}% of account`}
              accent={plan.riskPercent > 2 ? '#f87171' : '#34d399'} />
            <StatCard label="Stop" value={String(plan.stop)}
              sub={`${plan.stopPoints} pts`} />
            <StatCard label="Target" value={String(plan.target)}
              sub={`${plan.targetPoints} pts · ${plan.rr}:1 R:R`} accent="#34d399" />
          </div>

          {/* Risk table */}
          <div className="sigma-panel overflow-hidden">
            <div className="px-4 py-3 border-b" style={{ borderColor: 'var(--border)' }}>
              <span className="text-xs font-medium uppercase tracking-wider" style={{ color: 'var(--subtext)' }}>
                Plan Detail
              </span>
            </div>
            <table className="sigma-table">
              <tbody>
                {[
                  ['Symbol', plan.symbol],
                  ['Side', plan.side.toUpperCase()],
                  ['Entry', String(plan.entry)],
                  ['Stop', `${plan.stop} (${plan.stopPoints} pts)`],
                  ['Target', `${plan.target} (${plan.targetPoints} pts)`],
                  ['R:R', `${plan.rr}:1`],
                  ['Contracts', String(plan.contracts)],
                  ['Point Value', `$${plan.pointValue}/pt`],
                  ['Dollar Risk', `$${plan.riskDollars.toFixed(2)}`],
                  ['Risk %', `${plan.riskPercent.toFixed(2)}%`],
                ].map(([k, v]) => (
                  <tr key={k}>
                    <td className="text-xs" style={{ color: 'var(--subtext)', width: '40%' }}>{k}</td>
                    <td className="mono text-xs" style={{ color: 'var(--text)' }}>{v}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Warnings */}
          {plan.warnings.length > 0 && (
            <div className="sigma-panel p-4 space-y-1" style={{ borderColor: 'rgba(245,158,11,0.3)' }}>
              <div className="text-xs font-medium uppercase tracking-wider" style={{ color: 'var(--accent)' }}>Warnings</div>
              {plan.warnings.map((w, i) => (
                <div key={i} className="text-xs" style={{ color: '#fcd34d' }}>{w}</div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
