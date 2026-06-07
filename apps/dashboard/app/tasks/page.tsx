'use client';

import { useState } from 'react';

interface TaskResult {
  taskId: string;
  agent?: string;
  status: string;
  queue?: string;
  result?: unknown;
  error?: string;
  completedAt?: string;
  failedAt?: string;
}

function tokenHeaders(): Record<string, string> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (typeof window === 'undefined') return headers;
  const token = localStorage.getItem('sigma_token');
  if (token) headers.Authorization = `Bearer ${token}`;
  return headers;
}

function statusColor(status: string): string {
  if (status === 'queued') return 'var(--blue)';
  if (status === 'success' || status === 'complete') return 'var(--green)';
  if (status === 'error' || status === 'not_found' || status === 'unavailable') return 'var(--red)';
  return 'var(--muted)';
}

function formatJson(value: unknown): string {
  if (value === undefined || value === null) return '';
  return JSON.stringify(value, null, 2);
}

export default function TasksPage() {
  const [taskId, setTaskId] = useState('');
  const [taskType, setTaskType] = useState('unknown_task');
  const [payload, setPayload] = useState('{\n  "smoke": "dashboard-task-status"\n}');
  const [result, setResult] = useState<TaskResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function lookup(id = taskId.trim()) {
    if (!id) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/v1/task/${encodeURIComponent(id)}`, {
        credentials: 'include',
        headers: tokenHeaders(),
      });
      const data = await res.json();
      setResult(data);
      if (!res.ok && data?.status !== 'not_found') setError(data?.error ?? 'Task lookup failed');
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }

  async function submitTask() {
    setLoading(true);
    setError(null);
    try {
      let parsedPayload: Record<string, unknown>;
      try {
        parsedPayload = JSON.parse(payload) as Record<string, unknown>;
      } catch {
        setError('Payload must be valid JSON.');
        return;
      }

      const res = await fetch('/api/v1/task', {
        method: 'POST',
        credentials: 'include',
        headers: tokenHeaders(),
        body: JSON.stringify({
          type: taskType.trim() || 'unknown_task',
          payload: parsedPayload,
          submittedBy: 'sigma-dashboard',
        }),
      });
      const data = await res.json();
      setResult(data);
      if (data?.taskId) setTaskId(data.taskId);
      if (!res.ok) setError(data?.error ?? 'Task submit failed');
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="max-w-screen-2xl mx-auto p-6 space-y-6">
      <div className="flex items-end justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold">Task Queue</h1>
          <p className="text-sm mt-1" style={{ color: 'var(--muted)' }}>
            Submit safe worker checks and inspect Redis-backed task results.
          </p>
        </div>
        <div className="mono text-xs" style={{ color: 'var(--muted)' }}>
          queue: sigma:tasks
        </div>
      </div>

      <section className="grid gap-6 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
        <div className="sigma-panel p-5 space-y-4">
          <div>
            <h2 className="text-sm font-semibold">Submit Task</h2>
            <p className="text-xs mt-1" style={{ color: 'var(--muted)' }}>
              Default task type is intentionally harmless.
            </p>
          </div>

          <label className="block space-y-1">
            <span className="mono text-xs" style={{ color: 'var(--subtext)' }}>type</span>
            <input className="sigma-input" value={taskType} onChange={event => setTaskType(event.target.value)} />
          </label>

          <label className="block space-y-1">
            <span className="mono text-xs" style={{ color: 'var(--subtext)' }}>payload</span>
            <textarea
              className="sigma-input"
              value={payload}
              onChange={event => setPayload(event.target.value)}
              rows={8}
              style={{ resize: 'vertical' }}
            />
          </label>

          <button className="btn-primary" onClick={submitTask} disabled={loading}>
            {loading ? 'working...' : 'Submit'}
          </button>
        </div>

        <div className="sigma-panel p-5 space-y-4">
          <div>
            <h2 className="text-sm font-semibold">Lookup Result</h2>
            <p className="text-xs mt-1" style={{ color: 'var(--muted)' }}>
              Poll by task id after submit or paste a task id from API logs.
            </p>
          </div>

          <div className="flex gap-2">
            <input
              className="sigma-input"
              value={taskId}
              onChange={event => setTaskId(event.target.value)}
              placeholder="task id"
            />
            <button className="btn-ghost shrink-0" onClick={() => lookup()} disabled={loading || !taskId.trim()}>
              Refresh
            </button>
          </div>

          {error && (
            <div className="rounded-md border px-3 py-2 text-sm" style={{ borderColor: 'rgba(239,68,68,0.4)', color: 'var(--red)' }}>
              {error}
            </div>
          )}

          {result ? (
            <div className="space-y-4">
              <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                <div className="sigma-panel p-3">
                  <div className="mono text-xs" style={{ color: 'var(--muted)' }}>task</div>
                  <div className="mono text-xs mt-1 break-all">{result.taskId}</div>
                </div>
                <div className="sigma-panel p-3">
                  <div className="mono text-xs" style={{ color: 'var(--muted)' }}>status</div>
                  <div className="mono text-sm mt-1" style={{ color: statusColor(result.status) }}>{result.status}</div>
                </div>
                <div className="sigma-panel p-3">
                  <div className="mono text-xs" style={{ color: 'var(--muted)' }}>agent</div>
                  <div className="mono text-sm mt-1">{result.agent ?? '-'}</div>
                </div>
                <div className="sigma-panel p-3">
                  <div className="mono text-xs" style={{ color: 'var(--muted)' }}>queue</div>
                  <div className="mono text-sm mt-1">{result.queue ?? '-'}</div>
                </div>
              </div>

              {(result.completedAt || result.failedAt) && (
                <div className="mono text-xs" style={{ color: 'var(--muted)' }}>
                  {result.completedAt ? `completed: ${result.completedAt}` : `failed: ${result.failedAt}`}
                </div>
              )}

              <pre className="mono text-xs p-4 rounded-md overflow-auto" style={{ background: 'var(--input-bg)', border: '1px solid var(--border)', maxHeight: 360 }}>
                {formatJson(result.result ?? result.error ?? result)}
              </pre>
            </div>
          ) : (
            <div className="h-48 flex items-center justify-center rounded-md border border-dashed" style={{ borderColor: 'var(--border)', color: 'var(--muted)' }}>
              <span className="mono text-xs">no task selected</span>
            </div>
          )}
        </div>
      </section>
    </main>
  );
}
