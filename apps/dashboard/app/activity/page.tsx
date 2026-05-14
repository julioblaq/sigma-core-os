'use client';
import { useEffect, useState, useCallback } from 'react';

type Approval = {
  id: string; agent: string; action: string; description: string;
  status: 'pending' | 'approved' | 'denied';
  createdAt: string; resolvedAt?: string; resolvedBy?: string; reason?: string;
};

type LogEntry = {
  id: string; agent: string; taskType: string; outcome: string;
  resolvedBy?: string; loggedAt: string;
};

type Event = { time: string; type: string; agent: string; label: string; status: string };

function Badge({ status }: { status: string }) {
  const cls = status === 'pending' ? 'badge-pending' : status === 'approved' ? 'badge-approved' : 'badge-denied';
  return <span className={`${cls} px-2 py-0.5 rounded text-xs font-mono uppercase`}>{status}</span>;
}

function fmtTime(iso: string) {
  return new Date(iso).toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

export default function ActivityPage() {
  const [events, setEvents] = useState<Event[]>([]);
  const [loading, setLoading] = useState(true);
  const [agentCounts, setAgentCounts] = useState<Record<string, number>>({});

  const load = useCallback(async () => {
    const [approvals, log] = await Promise.all([
      fetch('/api/v1/approvals/history').then(r => r.json()),
      fetch('/api/v1/log').then(r => r.json()),
    ]);

    const allApprovals: Approval[] = Array.isArray(approvals) ? approvals : [];
    const allLog: LogEntry[] = Array.isArray(log) ? log : [];

    // Build unified event feed
    const feed: Event[] = [
      ...allApprovals.map(a => ({
        time: a.createdAt,
        type: 'approval_queued',
        agent: a.agent,
        label: `[${a.action}] ${a.description.slice(0, 60)}`,
        status: a.status,
      })),
      ...allLog.map(l => ({
        time: l.loggedAt,
        type: 'outcome_logged',
        agent: l.agent,
        label: `Task ${l.taskType} resolved`,
        status: l.outcome,
      })),
    ].sort((a, b) => new Date(b.time).getTime() - new Date(a.time).getTime());

    // Agent stats
    const counts: Record<string, number> = {};
    allApprovals.forEach(a => { counts[a.agent] = (counts[a.agent] ?? 0) + 1; });

    setEvents(feed);
    setAgentCounts(counts);
    setLoading(false);
  }, []);

  useEffect(() => { load(); const t = setInterval(load, 5000); return () => clearInterval(t); }, [load]);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-lg font-semibold" style={{ color: 'var(--text)' }}>Agent Activity</h1>
          <p className="text-xs mt-0.5" style={{ color: 'var(--subtext)' }}>
            {loading ? 'Loading...' : `${events.length} events · auto-refresh 5s`}
          </p>
        </div>
      </div>

      {/* Agent stat cards */}
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        {Object.entries(agentCounts).map(([agent, count]) => (
          <div key={agent} className="sigma-panel p-4">
            <div className="text-xs mb-1" style={{ color: 'var(--subtext)' }}>Agent</div>
            <div className="mono text-sm font-medium" style={{ color: 'var(--accent)' }}>{agent}</div>
            <div className="text-2xl font-semibold mt-2" style={{ color: 'var(--text)' }}>{count}</div>
            <div className="text-xs mt-0.5" style={{ color: 'var(--muted)' }}>total tasks</div>
          </div>
        ))}
        {Object.keys(agentCounts).length === 0 && !loading && (
          <div className="sigma-panel p-4 col-span-4">
            <p className="text-xs text-center" style={{ color: 'var(--muted)' }}>No agent activity yet</p>
          </div>
        )}
      </div>

      {/* Event feed */}
      <section className="sigma-panel overflow-hidden">
        <div className="px-4 py-3 border-b" style={{ borderColor: 'var(--border)' }}>
          <span className="text-xs font-medium uppercase tracking-wider" style={{ color: 'var(--subtext)' }}>Live Feed</span>
        </div>
        {events.length === 0 ? (
          <div className="px-4 py-10 text-center text-xs" style={{ color: 'var(--muted)' }}>No activity yet</div>
        ) : (
          <div className="divide-y" style={{ borderColor: 'var(--border)' }}>
            {events.slice(0, 100).map((e, i) => (
              <div key={i} className="flex items-start gap-4 px-4 py-3 hover:bg-sigma-hover transition-colors">
                <div className="mono text-xs pt-0.5 w-16 shrink-0" style={{ color: 'var(--muted)' }}>{fmtTime(e.time)}</div>
                <div className="shrink-0">
                  <span className="mono text-xs px-1.5 py-0.5 rounded" style={{ background: 'rgba(245,158,11,0.1)', color: 'var(--accent)' }}>{e.agent}</span>
                </div>
                <div className="shrink-0">
                  <span className="mono text-xs" style={{ color: 'var(--muted)' }}>{e.type}</span>
                </div>
                <div className="flex-1 text-xs truncate" style={{ color: 'var(--text)' }}>{e.label}</div>
                <div className="shrink-0"><Badge status={e.status} /></div>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
