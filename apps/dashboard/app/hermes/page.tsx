'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';

interface HermesConfig {
  baseUrl: string;
  model: string;
  apiKeySet: boolean;
}

interface HermesStatus {
  configured: boolean;
  ok: boolean;
  statusCode: number | null;
  latencyMs: number;
  platform?: string;
  error?: string;
}

interface HermesModels {
  models?: Array<{ id: string }>;
  error?: string;
}

interface DraftResult {
  approval?: {
    id: string;
    status: string;
    action: string;
    description: string;
  };
  error?: string;
}

interface DispatchResult {
  approvalId?: string;
  result?: {
    content: string;
    model: string;
    sessionId?: string;
    finishReason?: string;
    latencyMs: number;
    usage?: {
      promptTokens: number;
      completionTokens: number;
      totalTokens: number;
    };
  };
  error?: string;
}

function tokenHeaders(): Record<string, string> {
  const token = typeof window !== 'undefined' ? localStorage.getItem('sigma_token') : null;
  return token ? { Authorization: `Bearer ${token}` } : {};
}

function shortId(id: string): string {
  return id.length > 10 ? id.slice(0, 10) : id;
}

export default function HermesPage() {
  const [config, setConfig] = useState<HermesConfig | null>(null);
  const [status, setStatus] = useState<HermesStatus | null>(null);
  const [model, setModel] = useState('');
  const [prompt, setPrompt] = useState('');
  const [systemPrompt, setSystemPrompt] = useState('You are Hermes working through Sigma Core OS. Be concise and do not take external actions.');
  const [sessionId, setSessionId] = useState('');
  const [approvalId, setApprovalId] = useState('');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [dispatch, setDispatch] = useState<DispatchResult | null>(null);

  async function loadHermes() {
    try {
      const headers = tokenHeaders();
      const [cfg, health, modelPayload]: [HermesConfig, HermesStatus, HermesModels] = await Promise.all([
        fetch('/api/v1/hermes/config', { headers }).then(r => r.json()),
        fetch('/api/v1/hermes/status', { headers }).then(r => r.json()),
        fetch('/api/v1/hermes/models', { headers }).then(r => r.json()),
      ]);
      setConfig(cfg);
      setStatus(health);
      setModel(modelPayload.models?.[0]?.id ?? cfg.model);
    } catch (err) {
      setStatus({
        configured: false,
        ok: false,
        statusCode: null,
        latencyMs: 0,
        error: err instanceof Error ? err.message : 'Hermes unavailable',
      });
    }
  }

  useEffect(() => {
    loadHermes();
  }, []);

  async function queueApproval() {
    const cleanPrompt = prompt.trim();
    if (!cleanPrompt) {
      setMessage('prompt required');
      return;
    }
    setBusy(true);
    setDispatch(null);
    setMessage('queueing approval');
    try {
      const res = await fetch('/api/v1/hermes/draft-chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...tokenHeaders() },
        body: JSON.stringify({
          prompt: cleanPrompt,
          systemPrompt: systemPrompt.trim() || undefined,
          sessionId: sessionId.trim() || undefined,
          submittedBy: 'dashboard',
        }),
      });
      const data = await res.json() as DraftResult;
      if (!res.ok) throw new Error(data.error ?? 'approval queue failed');
      const id = data.approval?.id ?? '';
      setApprovalId(id);
      setMessage(id ? `queued ${shortId(id)}` : 'queued');
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'approval queue failed');
    } finally {
      setBusy(false);
    }
  }

  async function dispatchApproved() {
    const cleanId = approvalId.trim();
    if (!cleanId) {
      setMessage('approval id required');
      return;
    }
    setBusy(true);
    setMessage('dispatching');
    setDispatch(null);
    try {
      const res = await fetch('/api/v1/hermes/dispatch-chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...tokenHeaders() },
        body: JSON.stringify({ approvalId: cleanId }),
      });
      const data = await res.json() as DispatchResult;
      if (!res.ok) throw new Error(data.error ?? 'dispatch failed');
      setDispatch(data);
      if (data.result?.sessionId) setSessionId(data.result.sessionId);
      setMessage('dispatch complete');
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'dispatch failed');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-lg font-semibold text-sigma-text">Hermes</h1>
          <p className="text-xs mt-0.5" style={{ color: 'var(--subtext)' }}>
            {model || config?.model || 'loading'}
          </p>
        </div>
        <button onClick={loadHermes} className="btn-ghost text-xs">
          Refresh
        </button>
      </div>

      <section className="sigma-panel p-4">
        <div className="grid gap-3 md:grid-cols-4">
          <div className="rounded border p-3" style={{ borderColor: 'var(--border)', background: 'rgba(255,255,255,0.03)' }}>
            <div className="text-xs" style={{ color: 'var(--subtext)' }}>Status</div>
            <div className="mt-1 mono text-sm" style={{ color: status?.ok ? 'var(--green)' : 'var(--red)' }}>
              {status?.ok ? 'online' : 'offline'}
            </div>
          </div>
          <div className="rounded border p-3" style={{ borderColor: 'var(--border)', background: 'rgba(255,255,255,0.03)' }}>
            <div className="text-xs" style={{ color: 'var(--subtext)' }}>Auth</div>
            <div className="mt-1 mono text-sm" style={{ color: config?.apiKeySet ? 'var(--green)' : 'var(--red)' }}>
              {config?.apiKeySet ? 'key:set' : 'key:missing'}
            </div>
          </div>
          <div className="rounded border p-3" style={{ borderColor: 'var(--border)', background: 'rgba(255,255,255,0.03)' }}>
            <div className="text-xs" style={{ color: 'var(--subtext)' }}>Latency</div>
            <div className="mt-1 mono text-sm" style={{ color: 'var(--text)' }}>
              {typeof status?.latencyMs === 'number' ? `${status.latencyMs}ms` : '-'}
            </div>
          </div>
          <div className="rounded border p-3" style={{ borderColor: 'var(--border)', background: 'rgba(255,255,255,0.03)' }}>
            <div className="text-xs" style={{ color: 'var(--subtext)' }}>Platform</div>
            <div className="mt-1 mono text-sm truncate" style={{ color: 'var(--text)' }}>
              {status?.platform ?? 'unknown'}
            </div>
          </div>
        </div>
        {status?.error && (
          <div className="mt-3 mono text-xs" style={{ color: 'var(--red)' }}>{status.error}</div>
        )}
      </section>

      <section className="sigma-panel p-4 space-y-4">
        <div className="grid gap-4 lg:grid-cols-[1fr_320px]">
          <div className="space-y-3">
            <label className="block">
              <span className="block text-xs mb-1" style={{ color: 'var(--subtext)' }}>Prompt</span>
              <textarea
                value={prompt}
                onChange={e => setPrompt(e.target.value)}
                className="sigma-input min-h-48"
                style={{ resize: 'vertical' }}
                placeholder="Ask Hermes for the next approved cloud task."
              />
            </label>
            <label className="block">
              <span className="block text-xs mb-1" style={{ color: 'var(--subtext)' }}>System</span>
              <textarea
                value={systemPrompt}
                onChange={e => setSystemPrompt(e.target.value)}
                className="sigma-input min-h-24"
                style={{ resize: 'vertical' }}
              />
            </label>
          </div>

          <div className="space-y-3">
            <label className="block">
              <span className="block text-xs mb-1" style={{ color: 'var(--subtext)' }}>Session</span>
              <input
                value={sessionId}
                onChange={e => setSessionId(e.target.value)}
                className="sigma-input"
                placeholder="optional"
              />
            </label>
            <button
              onClick={queueApproval}
              disabled={busy || !prompt.trim()}
              className="btn-primary w-full"
            >
              Queue Approval
            </button>
            <div className="pt-2 border-t" style={{ borderColor: 'var(--border)' }}>
              <label className="block">
                <span className="block text-xs mb-1" style={{ color: 'var(--subtext)' }}>Approval</span>
                <input
                  value={approvalId}
                  onChange={e => setApprovalId(e.target.value)}
                  className="sigma-input"
                  placeholder="approval id"
                />
              </label>
            </div>
            <button
              onClick={dispatchApproved}
              disabled={busy || !approvalId.trim()}
              className="btn-ghost w-full"
            >
              Dispatch Approved
            </button>
            <div className="flex items-center justify-between gap-3">
              <span className="mono text-xs truncate" style={{ color: 'var(--muted)' }}>{message || 'idle'}</span>
              {approvalId && (
                <Link href="/approvals" className="mono text-xs shrink-0" style={{ color: 'var(--accent)' }}>
                  open queue
                </Link>
              )}
            </div>
          </div>
        </div>
      </section>

      {dispatch?.result && (
        <section className="sigma-panel overflow-hidden">
          <div className="px-4 py-3 border-b flex items-center justify-between gap-4" style={{ borderColor: 'var(--border)' }}>
            <div className="mono text-xs" style={{ color: 'var(--subtext)' }}>
              {dispatch.result.model} / {dispatch.result.latencyMs}ms
            </div>
            <div className="mono text-xs" style={{ color: 'var(--muted)' }}>
              {dispatch.result.finishReason ?? 'complete'}
            </div>
          </div>
          <pre className="whitespace-pre-wrap p-4 text-sm mono" style={{ color: 'var(--text)' }}>
            {dispatch.result.content}
          </pre>
          {(dispatch.result.sessionId || dispatch.result.usage) && (
            <div className="px-4 py-3 border-t flex flex-wrap gap-4 mono text-xs" style={{ borderColor: 'var(--border)', color: 'var(--muted)' }}>
              {dispatch.result.sessionId && <span>session:{shortId(dispatch.result.sessionId)}</span>}
              {dispatch.result.usage && <span>tokens:{dispatch.result.usage.totalTokens}</span>}
            </div>
          )}
        </section>
      )}
    </div>
  );
}
