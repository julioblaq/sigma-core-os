'use client';

import { useEffect, useState, useCallback } from 'react';

interface GitHubIssue {
  id: number;
  title: string;
  url: string;
  number: number;
  createdAt: string;
  labels: string[];
}

interface GitHubPR {
  id: number;
  title: string;
  url: string;
  number: number;
  createdAt: string;
  user: string;
  labels: string[];
}

interface JulesWork {
  issues: GitHubIssue[];
  pullRequests: GitHubPR[];
}

function fmtDate(iso: string) {
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

export default function MindLyftPage() {
  const [work, setWork] = useState<JulesWork | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadWork = useCallback(async () => {
    try {
      const res = await fetch('/api/v1/github/jules-work');
      if (!res.ok) throw new Error('Failed to fetch Jules work');
      const data = await res.json();
      setWork(data);
      setError(null);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadWork();
    const t = setInterval(loadWork, 30000); // Refresh every 30s
    return () => clearInterval(t);
  }, [loadWork]);

  return (
    <div className="space-y-8">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-sigma-text">MindLyft Command Center</h1>
          <p className="text-xs mt-1" style={{ color: 'var(--subtext)' }}>
            High-level project coordination and Jules' task tracking.
          </p>
        </div>
        <button onClick={loadWork} disabled={loading} className="text-xs px-3 py-1.5 rounded border transition-colors hover:bg-sigma-hover" style={{ borderColor: 'var(--border)', color: 'var(--subtext)' }}>
          {loading ? 'Refreshing...' : 'Refresh'}
        </button>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-8">
        {/* Open Tasks Panel */}
        <section className="sigma-panel overflow-hidden flex flex-col">
          <div className="px-4 py-3 border-b flex items-center justify-between" style={{ borderColor: 'var(--border)' }}>
            <div className="flex items-center gap-2">
              <span className="w-2 h-2 rounded-full" style={{ background: 'var(--accent)' }} />
              <span className="text-xs font-medium uppercase tracking-wider" style={{ color: 'var(--subtext)' }}>
                Open Jules Tasks (Issues)
              </span>
            </div>
            {work && (
              <span className="mono text-xs px-2 py-0.5 rounded" style={{ background: 'rgba(245,158,11,0.1)', color: 'var(--accent)' }}>
                {work.issues.length}
              </span>
            )}
          </div>

          <div className="flex-1 overflow-auto max-h-[600px]">
            {loading && !work ? (
              <div className="px-4 py-10 text-center text-xs" style={{ color: 'var(--muted)' }}>Loading tasks...</div>
            ) : error ? (
              <div className="px-4 py-10 text-center text-xs" style={{ color: 'var(--red)' }}>{error}</div>
            ) : work?.issues.length === 0 ? (
              <div className="px-4 py-10 text-center text-xs" style={{ color: 'var(--muted)' }}>No open tasks found.</div>
            ) : (
              <table className="sigma-table">
                <thead>
                  <tr>
                    <th>#</th>
                    <th>Title</th>
                    <th>Labels</th>
                    <th>Created</th>
                  </tr>
                </thead>
                <tbody>
                  {work?.issues.map(issue => (
                    <tr key={issue.id} className="group">
                      <td className="mono text-xs" style={{ color: 'var(--muted)' }}>{issue.number}</td>
                      <td>
                        <a href={issue.url} target="_blank" rel="noopener noreferrer" className="text-xs hover:underline block" style={{ color: 'var(--text)' }}>
                          {issue.title}
                        </a>
                      </td>
                      <td>
                        <div className="flex flex-wrap gap-1">
                          {issue.labels.map(label => (
                            <span key={label} className="mono text-[10px] px-1.5 py-0.5 rounded border" style={{ borderColor: 'var(--border)', color: 'var(--subtext)', background: 'rgba(255,255,255,0.03)' }}>
                              {label}
                            </span>
                          ))}
                        </div>
                      </td>
                      <td className="mono text-xs whitespace-nowrap" style={{ color: 'var(--muted)' }}>{fmtDate(issue.createdAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </section>

        {/* Pull Requests Panel */}
        <section className="sigma-panel overflow-hidden flex flex-col">
          <div className="px-4 py-3 border-b flex items-center justify-between" style={{ borderColor: 'var(--border)' }}>
            <div className="flex items-center gap-2">
              <span className="w-2 h-2 rounded-full" style={{ background: '#60a5fa' }} />
              <span className="text-xs font-medium uppercase tracking-wider" style={{ color: 'var(--subtext)' }}>
                Jules PRs Waiting for Review
              </span>
            </div>
            {work && (
              <span className="mono text-xs px-2 py-0.5 rounded" style={{ background: 'rgba(96,165,250,0.1)', color: '#60a5fa' }}>
                {work.pullRequests.length}
              </span>
            )}
          </div>

          <div className="flex-1 overflow-auto max-h-[600px]">
            {loading && !work ? (
              <div className="px-4 py-10 text-center text-xs" style={{ color: 'var(--muted)' }}>Loading PRs...</div>
            ) : error ? (
              <div className="px-4 py-10 text-center text-xs" style={{ color: 'var(--red)' }}>{error}</div>
            ) : work?.pullRequests.length === 0 ? (
              <div className="px-4 py-10 text-center text-xs" style={{ color: 'var(--muted)' }}>No open PRs waiting for review.</div>
            ) : (
              <table className="sigma-table">
                <thead>
                  <tr>
                    <th>#</th>
                    <th>Title</th>
                    <th>Author</th>
                    <th>Labels</th>
                  </tr>
                </thead>
                <tbody>
                  {work?.pullRequests.map(pr => (
                    <tr key={pr.id} className="group">
                      <td className="mono text-xs" style={{ color: 'var(--muted)' }}>{pr.number}</td>
                      <td>
                        <a href={pr.url} target="_blank" rel="noopener noreferrer" className="text-xs hover:underline block" style={{ color: 'var(--text)' }}>
                          {pr.title}
                        </a>
                      </td>
                      <td className="mono text-xs" style={{ color: 'var(--subtext)' }}>{pr.user}</td>
                      <td>
                        <div className="flex flex-wrap gap-1">
                          {pr.labels.map(label => (
                            <span key={label} className="mono text-[10px] px-1.5 py-0.5 rounded border" style={{ borderColor: 'var(--border)', color: 'var(--subtext)', background: 'rgba(255,255,255,0.03)' }}>
                              {label}
                            </span>
                          ))}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </section>
      </div>

      {/* Safety Reminder Card */}
      <div className="sigma-panel p-4 border-l-4" style={{ borderLeftColor: 'var(--accent)' }}>
        <p className="text-xs mono font-semibold mb-1" style={{ color: 'var(--accent)' }}>AGENT SAFETY ADVISORY</p>
        <p className="text-xs" style={{ color: 'var(--subtext)' }}>
          MindLyft agents must adhere to the Sigma Core OS safety protocols. All logic changes require human review and PR approval before merge.
          Live trading execution and production credentials are strictly restricted.
        </p>
      </div>
    </div>
  );
}
