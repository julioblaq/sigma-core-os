// apps/dashboard/app/performance/page.tsx
'use client';
import { useState, useCallback } from 'react';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
interface PerfSummary {
  totalTrades: number; wins: number; losses: number; scratches: number;
  winRate: number; totalPnl: number; averageWin: number; averageLoss: number;
  profitFactor: number; expectancy: number; averageRMultiple: number;
  maxWinStreak: number; maxLossStreak: number; largestWin: number; largestLoss: number;
}
interface EquityPoint { date: string; pnl: number; cumulative: number; tradeId: string; }
interface DrawdownPoint { date: string; cumulative: number; peak: number; drawdown: number; drawdownPct: number; }
interface CalendarDay { date: string; pnl: number; trades: number; wins: number; losses: number; }
interface StratBreakdown { strategyId: string | null; label: string; trades: number; wins: number; winRate: number; totalPnl: number; averagePnl: number; profitFactor: number; }
interface InstBreakdown { symbol: string; trades: number; wins: number; winRate: number; totalPnl: number; averagePnl: number; profitFactor: number; }

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
const fmt = (n: number, prefix = '$') => {
  const s = Math.abs(n).toFixed(2);
  return (n < 0 ? '-' : '') + prefix + s;
};
const pnlColor = (n: number) => n > 0 ? 'var(--green)' : n < 0 ? 'var(--red)' : 'var(--muted)';

function SummaryCard({ label, value, sub, color }: { label: string; value: string; sub?: string; color?: string }) {
  return (
    <div style={{
      background: 'var(--panel)', border: '1px solid var(--border)', borderRadius: 8,
      padding: '14px 18px', minWidth: 140,
    }}>
      <div style={{ fontSize: 11, color: 'var(--muted)', fontFamily: 'var(--font-mono)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 6 }}>{label}</div>
      <div style={{ fontSize: 22, fontWeight: 700, fontFamily: 'var(--font-mono)', color: color ?? 'var(--text)' }}>{value}</div>
      {sub && <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 3 }}>{sub}</div>}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Mini bar chart for equity / drawdown
// ---------------------------------------------------------------------------
function MiniBarChart({ points, colorFn, label }: {
  points: { y: number; x: string }[];
  colorFn: (v: number) => string;
  label: string;
}) {
  if (points.length === 0) return (
    <div style={{ color: 'var(--muted)', fontSize: 13, textAlign: 'center', padding: 32 }}>No data</div>
  );
  const maxAbs = Math.max(...points.map(p => Math.abs(p.y)), 1);
  const H = 80;
  return (
    <div>
      <div style={{ fontSize: 11, color: 'var(--muted)', fontFamily: 'var(--font-mono)', marginBottom: 8 }}>{label}</div>
      <div style={{ display: 'flex', alignItems: 'flex-end', gap: 2, height: H }}>
        {points.map((p, i) => {
          const h = Math.max(2, Math.round((Math.abs(p.y) / maxAbs) * H));
          return (
            <div key={i} title={`${p.x}: ${p.y.toFixed(2)}`} style={{
              flex: 1, height: h, background: colorFn(p.y),
              borderRadius: 2, cursor: 'default', minWidth: 2,
              opacity: 0.85,
            }} />
          );
        })}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Calendar heatmap
// ---------------------------------------------------------------------------
function CalendarGrid({ days }: { days: CalendarDay[] }) {
  if (days.length === 0) return (
    <div style={{ color: 'var(--muted)', fontSize: 13, textAlign: 'center', padding: 32 }}>No closed trades</div>
  );
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
      {days.map(d => {
        const pnl = d.pnl;
        const bg = pnl > 0 ? `rgba(34,197,94,${Math.min(0.9, 0.2 + pnl / 500)})`
          : pnl < 0 ? `rgba(239,68,68,${Math.min(0.9, 0.2 + Math.abs(pnl) / 500)})`
          : 'rgba(100,100,100,0.2)';
        return (
          <div key={d.date} title={`${d.date}: ${fmt(pnl)} (${d.trades} trades, ${d.wins}W/${d.losses}L)`}
            style={{ width: 36, height: 36, borderRadius: 4, background: bg, cursor: 'default',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: 9, fontFamily: 'var(--font-mono)', color: 'rgba(255,255,255,0.8)',
            }}>
            {d.date.slice(5)}
          </div>
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main page
// ---------------------------------------------------------------------------
export default function PerformancePage() {
  const [workspaceId, setWorkspaceId] = useState('');
  const [strategyId, setStrategyId] = useState('');
  const [symbol, setSymbol] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [loaded, setLoaded] = useState(false);

  const [summary, setSummary] = useState<PerfSummary | null>(null);
  const [equity, setEquity] = useState<EquityPoint[]>([]);
  const [drawdown, setDrawdown] = useState<DrawdownPoint[]>([]);
  const [calendar, setCalendar] = useState<CalendarDay[]>([]);
  const [stratBreakdown, setStratBreakdown] = useState<StratBreakdown[]>([]);
  const [instBreakdown, setInstBreakdown] = useState<InstBreakdown[]>([]);

  const buildParams = useCallback(() => {
    const p = new URLSearchParams();
    if (strategyId) p.set('strategyId', strategyId);
    if (symbol) p.set('symbol', symbol.toUpperCase());
    if (from) p.set('from', from);
    if (to) p.set('to', to);
    return p.toString() ? '?' + p.toString() : '';
  }, [strategyId, symbol, from, to]);

  async function load(e: React.FormEvent) {
    e.preventDefault();
    if (!workspaceId.trim()) { setError('Workspace ID is required'); return; }
    setLoading(true); setError(''); setLoaded(false);
    try {
      const base = `/api/v1/workspaces/${workspaceId.trim()}/performance`;
      const qs = buildParams();
      const token = typeof window !== 'undefined' ? localStorage.getItem('sigma_token') : null;
      const headers: Record<string, string> = {};
      if (token) headers['Authorization'] = `Bearer ${token}`;

      const [s, eq, dd, cal, bd] = await Promise.all([
        fetch(`${base}/summary${qs}`, { credentials: 'include', headers }).then(r => r.json()),
        fetch(`${base}/equity${qs}`, { credentials: 'include', headers }).then(r => r.json()),
        fetch(`${base}/drawdown${qs}`, { credentials: 'include', headers }).then(r => r.json()),
        fetch(`${base}/calendar${qs}`, { credentials: 'include', headers }).then(r => r.json()),
        fetch(`${base}/breakdown${qs}`, { credentials: 'include', headers }).then(r => r.json()),
      ]);
      if (s.error) throw new Error(s.error);
      setSummary(s); setEquity(Array.isArray(eq) ? eq : []);
      setDrawdown(Array.isArray(dd) ? dd : []);
      setCalendar(Array.isArray(cal) ? cal : []);
      setStratBreakdown(Array.isArray(bd?.byStrategy) ? bd.byStrategy : []);
      setInstBreakdown(Array.isArray(bd?.byInstrument) ? bd.byInstrument : []);
      setLoaded(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Load failed');
    } finally {
      setLoading(false);
    }
  }

  const fieldStyle = {
    background: 'var(--panel)', border: '1px solid var(--border)', color: 'var(--text)',
    borderRadius: 6, padding: '6px 10px', fontSize: 13, fontFamily: 'var(--font-mono)', width: '100%',
  };
  const labelStyle = {
    display: 'block', fontSize: 11, color: 'var(--muted)', marginBottom: 3,
    fontFamily: 'var(--font-mono)', textTransform: 'uppercase' as const, letterSpacing: '0.05em',
  };

  const pfVal = summary ? (summary.profitFactor === Infinity ? '∞' : summary.profitFactor.toFixed(2)) : '—';

  return (
    <div className="p-6 max-w-screen-2xl mx-auto">
      <div style={{ marginBottom: 24 }}>
        <h1 className="mono font-semibold text-lg" style={{ color: 'var(--text)' }}>Performance Dashboard</h1>
        <p style={{ color: 'var(--muted)', fontSize: 13, marginTop: 4 }}>
          Closed-trade analytics. Open trades excluded. Filter by strategy, instrument, or date range.
        </p>
      </div>

      {/* Filter form */}
      <form onSubmit={load} style={{ background: 'var(--panel)', border: '1px solid var(--border)', borderRadius: 8, padding: 20, marginBottom: 28 }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))', gap: 14, marginBottom: 16 }}>
          <div><label style={labelStyle}>Workspace ID *</label>
            <input required style={fieldStyle} value={workspaceId} onChange={e => setWorkspaceId(e.target.value)} placeholder="workspace uuid" /></div>
          <div><label style={labelStyle}>Strategy ID</label>
            <input style={fieldStyle} value={strategyId} onChange={e => setStrategyId(e.target.value)} placeholder="optional" /></div>
          <div><label style={labelStyle}>Symbol</label>
            <input style={fieldStyle} value={symbol} onChange={e => setSymbol(e.target.value)} placeholder="ES, MES…" /></div>
          <div><label style={labelStyle}>From</label>
            <input type="date" style={fieldStyle} value={from} onChange={e => setFrom(e.target.value ? e.target.value + 'T00:00:00.000Z' : '')} /></div>
          <div><label style={labelStyle}>To</label>
            <input type="date" style={fieldStyle} value={to} onChange={e => setTo(e.target.value ? e.target.value + 'T23:59:59.999Z' : '')} /></div>
        </div>
        <button type="submit" disabled={loading} style={{
          background: 'var(--accent)', color: '#000', border: 'none', borderRadius: 6,
          padding: '7px 18px', fontSize: 13, fontFamily: 'var(--font-mono)', fontWeight: 700,
          cursor: loading ? 'not-allowed' : 'pointer', opacity: loading ? 0.6 : 1,
        }}>{loading ? 'Loading…' : 'Load'}</button>
      </form>

      {error && <div style={{ background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.3)', borderRadius: 6, padding: '10px 14px', color: '#f87171', fontSize: 13, marginBottom: 20 }}>{error}</div>}

      {loaded && summary && (
        <>
          {/* Summary cards */}
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, marginBottom: 28 }}>
            <SummaryCard label="Total Trades" value={String(summary.totalTrades)} sub={`${summary.wins}W / ${summary.losses}L / ${summary.scratches}S`} />
            <SummaryCard label="Win Rate" value={`${summary.winRate}%`} color={summary.winRate >= 50 ? 'var(--green)' : 'var(--red)'} />
            <SummaryCard label="Total P&L" value={fmt(summary.totalPnl)} color={pnlColor(summary.totalPnl)} />
            <SummaryCard label="Expectancy" value={fmt(summary.expectancy)} sub="avg per trade" color={pnlColor(summary.expectancy)} />
            <SummaryCard label="Profit Factor" value={pfVal} color={summary.profitFactor >= 1.5 ? 'var(--green)' : summary.profitFactor < 1 ? 'var(--red)' : 'var(--text)'} />
            <SummaryCard label="Avg Win" value={fmt(summary.averageWin)} color="var(--green)" />
            <SummaryCard label="Avg Loss" value={fmt(summary.averageLoss)} color="var(--red)" />
            <SummaryCard label="Avg R Multiple" value={summary.averageRMultiple.toFixed(2) + 'R'} />
            <SummaryCard label="Win Streak" value={`${summary.maxWinStreak}`} sub="max consecutive" color="var(--green)" />
            <SummaryCard label="Loss Streak" value={`${summary.maxLossStreak}`} sub="max consecutive" color="var(--red)" />
            <SummaryCard label="Largest Win" value={fmt(summary.largestWin)} color="var(--green)" />
            <SummaryCard label="Largest Loss" value={fmt(summary.largestLoss)} color="var(--red)" />
          </div>

          {/* Charts row */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20, marginBottom: 28 }}>
            <div style={{ background: 'var(--panel)', border: '1px solid var(--border)', borderRadius: 8, padding: 20 }}>
              <h2 style={{ fontSize: 13, fontFamily: 'var(--font-mono)', color: 'var(--text)', marginBottom: 16 }}>Equity Curve</h2>
              <MiniBarChart
                points={equity.map(p => ({ x: p.date, y: p.cumulative }))}
                colorFn={v => v >= 0 ? 'rgba(34,197,94,0.7)' : 'rgba(239,68,68,0.7)'}
                label="Cumulative P&L per trade"
              />
              {equity.length > 0 && (
                <div style={{ marginTop: 10, fontSize: 12, color: 'var(--muted)', fontFamily: 'var(--font-mono)' }}>
                  Final: {fmt(equity[equity.length - 1].cumulative)} over {equity.length} trades
                </div>
              )}
            </div>
            <div style={{ background: 'var(--panel)', border: '1px solid var(--border)', borderRadius: 8, padding: 20 }}>
              <h2 style={{ fontSize: 13, fontFamily: 'var(--font-mono)', color: 'var(--text)', marginBottom: 16 }}>Drawdown</h2>
              <MiniBarChart
                points={drawdown.map(p => ({ x: p.date, y: -p.drawdown }))}
                colorFn={() => 'rgba(239,68,68,0.65)'}
                label="Drawdown from peak (dollars)"
              />
              {drawdown.length > 0 && (
                <div style={{ marginTop: 10, fontSize: 12, color: 'var(--muted)', fontFamily: 'var(--font-mono)' }}>
                  Max drawdown: {fmt(Math.max(...drawdown.map(p => p.drawdown)))} ({Math.max(...drawdown.map(p => p.drawdownPct)).toFixed(1)}%)
                </div>
              )}
            </div>
          </div>

          {/* Calendar */}
          <div style={{ background: 'var(--panel)', border: '1px solid var(--border)', borderRadius: 8, padding: 20, marginBottom: 28 }}>
            <h2 style={{ fontSize: 13, fontFamily: 'var(--font-mono)', color: 'var(--text)', marginBottom: 16 }}>Daily P&L Calendar</h2>
            <CalendarGrid days={calendar} />
          </div>

          {/* Breakdown tables */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20 }}>
            {/* Strategy breakdown */}
            <div style={{ background: 'var(--panel)', border: '1px solid var(--border)', borderRadius: 8, padding: 20 }}>
              <h2 style={{ fontSize: 13, fontFamily: 'var(--font-mono)', color: 'var(--text)', marginBottom: 14 }}>By Strategy</h2>
              {stratBreakdown.length === 0 ? <div style={{ color: 'var(--muted)', fontSize: 13 }}>No data</div> : (
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                  <thead>
                    <tr style={{ borderBottom: '1px solid var(--border)' }}>
                      {['Strategy', 'Trades', 'Win%', 'P&L', 'PF'].map(h => (
                        <th key={h} style={{ textAlign: 'left', padding: '4px 8px', color: 'var(--muted)', fontFamily: 'var(--font-mono)', fontSize: 10, textTransform: 'uppercase' }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {stratBreakdown.map((s, i) => (
                      <tr key={i} style={{ borderBottom: '1px solid var(--border)' }}>
                        <td style={{ padding: '6px 8px', fontFamily: 'var(--font-mono)', color: 'var(--text)', maxWidth: 120, overflow: 'hidden', textOverflow: 'ellipsis' }}>{s.label}</td>
                        <td style={{ padding: '6px 8px', color: 'var(--muted)' }}>{s.trades}</td>
                        <td style={{ padding: '6px 8px', color: s.winRate >= 50 ? 'var(--green)' : 'var(--red)' }}>{s.winRate}%</td>
                        <td style={{ padding: '6px 8px', color: pnlColor(s.totalPnl), fontFamily: 'var(--font-mono)' }}>{fmt(s.totalPnl)}</td>
                        <td style={{ padding: '6px 8px', color: 'var(--muted)' }}>{s.profitFactor === Infinity ? '∞' : s.profitFactor.toFixed(2)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
            {/* Instrument breakdown */}
            <div style={{ background: 'var(--panel)', border: '1px solid var(--border)', borderRadius: 8, padding: 20 }}>
              <h2 style={{ fontSize: 13, fontFamily: 'var(--font-mono)', color: 'var(--text)', marginBottom: 14 }}>By Instrument</h2>
              {instBreakdown.length === 0 ? <div style={{ color: 'var(--muted)', fontSize: 13 }}>No data</div> : (
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                  <thead>
                    <tr style={{ borderBottom: '1px solid var(--border)' }}>
                      {['Symbol', 'Trades', 'Win%', 'P&L', 'Avg P&L'].map(h => (
                        <th key={h} style={{ textAlign: 'left', padding: '4px 8px', color: 'var(--muted)', fontFamily: 'var(--font-mono)', fontSize: 10, textTransform: 'uppercase' }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {instBreakdown.map((b, i) => (
                      <tr key={i} style={{ borderBottom: '1px solid var(--border)' }}>
                        <td style={{ padding: '6px 8px', fontFamily: 'var(--font-mono)', color: 'var(--accent)', fontWeight: 700 }}>{b.symbol}</td>
                        <td style={{ padding: '6px 8px', color: 'var(--muted)' }}>{b.trades}</td>
                        <td style={{ padding: '6px 8px', color: b.winRate >= 50 ? 'var(--green)' : 'var(--red)' }}>{b.winRate}%</td>
                        <td style={{ padding: '6px 8px', color: pnlColor(b.totalPnl), fontFamily: 'var(--font-mono)' }}>{fmt(b.totalPnl)}</td>
                        <td style={{ padding: '6px 8px', color: pnlColor(b.averagePnl), fontFamily: 'var(--font-mono)' }}>{fmt(b.averagePnl)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
