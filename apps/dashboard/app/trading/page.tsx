'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

const API = '/api/v1';

type Side = 'long' | 'short';
type Status = 'pending' | 'approved' | 'denied';

interface TradePlan {
  symbol: string;
  side: Side;
  entry: number;
  stop: number;
  target: number;
  contracts: number;
  stopPoints: number;
  targetPoints: number;
  rr: number;
  riskDollars: number;
  riskPercent: number;
  warnings: string[];
  blocked: boolean;
  blockReasons: string[];
}

interface Approval {
  id: string;
  agent: string;
  action: string;
  description: string;
  status: Status;
  createdAt: string;
  resolvedAt?: string;
  resolvedBy?: string;
  reason?: string;
  payload?: {
    plan?: TradePlan;
    source?: string;
    executionMode?: string;
    submittedBy?: string;
    rawAlert?: Record<string, unknown>;
  };
}

interface TranscriptionResult {
  text: string;
  provider: string;
  model: string;
  latencyMs: number;
  error?: string;
}

function headers(): Record<string, string> {
  const h: Record<string, string> = { 'Content-Type': 'application/json' };
  const token = typeof window !== 'undefined' ? localStorage.getItem('sigma_token') : null;
  if (token) h.Authorization = `Bearer ${token}`;
  return h;
}

function fieldNumber(value: string): number {
  return Number.parseFloat(value);
}

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => {
      const result = String(reader.result ?? '');
      resolve(result.includes(',') ? result.split(',')[1] : result);
    };
    reader.onerror = () => reject(reader.error ?? new Error('audio read failed'));
    reader.readAsDataURL(blob);
  });
}

function fmtTime(iso: string): string {
  return new Date(iso).toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function Badge({ value, tone = 'neutral' }: { value: string; tone?: 'neutral' | 'green' | 'red' | 'blue' | 'amber' }) {
  const colors = {
    neutral: ['rgba(148,163,184,0.12)', 'var(--subtext)', 'rgba(148,163,184,0.25)'],
    green: ['rgba(16,185,129,0.15)', '#34d399', 'rgba(16,185,129,0.3)'],
    red: ['rgba(239,68,68,0.15)', '#f87171', 'rgba(239,68,68,0.3)'],
    blue: ['rgba(59,130,246,0.15)', '#60a5fa', 'rgba(59,130,246,0.3)'],
    amber: ['rgba(245,158,11,0.15)', 'var(--accent)', 'rgba(245,158,11,0.3)'],
  }[tone];

  return (
    <span className="mono text-xs px-2 py-0.5 rounded"
      style={{ background: colors[0], color: colors[1], border: `1px solid ${colors[2]}` }}>
      {value}
    </span>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1 text-xs" style={{ color: 'var(--subtext)' }}>
      <span className="uppercase tracking-wider">{label}</span>
      {children}
    </label>
  );
}

function Input({ value, onChange, type = 'number' }: {
  value: string;
  onChange: (value: string) => void;
  type?: string;
}) {
  return (
    <input
      value={value}
      type={type}
      onChange={event => onChange(event.target.value)}
      className="sigma-input"
    />
  );
}

function TradeRow({ approval }: { approval: Approval }) {
  const plan = approval.payload?.plan;
  const source = approval.payload?.source ?? 'manual';
  const executionMode = approval.payload?.executionMode ?? 'approval_only';
  const statusTone = approval.status === 'approved' ? 'green' : approval.status === 'denied' ? 'red' : 'blue';

  return (
    <tr>
      <td className="mono text-xs" style={{ color: 'var(--muted)' }}>{fmtTime(approval.createdAt)}</td>
      <td>
        <div className="flex items-center gap-2">
          <Badge value={source} tone={source === 'simulated' ? 'amber' : source === 'tradingview' ? 'blue' : 'neutral'} />
          <Badge value={executionMode} tone="neutral" />
        </div>
      </td>
      <td className="mono text-xs" style={{ color: 'var(--text)' }}>
        {plan ? `${plan.symbol} ${plan.side.toUpperCase()}` : approval.description}
      </td>
      <td className="mono text-xs" style={{ color: 'var(--subtext)' }}>
        {plan ? `${plan.contracts} @ ${plan.entry}` : '-'}
      </td>
      <td className="mono text-xs" style={{ color: 'var(--subtext)' }}>
        {plan ? `${plan.stop} / ${plan.target}` : '-'}
      </td>
      <td><Badge value={approval.status} tone={statusTone} /></td>
      <td>
        <Link href="/approvals" className="mono text-xs" style={{ color: 'var(--accent)' }}>
          Open
        </Link>
      </td>
    </tr>
  );
}

export default function TradingOpsPage() {
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<BlobPart[]>([]);
  const [symbol, setSymbol] = useState('MNQ');
  const [side, setSide] = useState<Side>('long');
  const [entry, setEntry] = useState('19000');
  const [stopPoints, setStopPoints] = useState('10');
  const [rrRatio, setRrRatio] = useState('2');
  const [accountSize, setAccountSize] = useState('5000');
  const [riskDollars, setRiskDollars] = useState('100');
  const [dailyLossDollars, setDailyLossDollars] = useState('');
  const [pending, setPending] = useState<Approval[]>([]);
  const [history, setHistory] = useState<Approval[]>([]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<{ approvalId?: string; plan?: TradePlan; error?: string; status?: number } | null>(null);
  const [recording, setRecording] = useState(false);
  const [audioBlob, setAudioBlob] = useState<Blob | null>(null);
  const [voiceTranscript, setVoiceTranscript] = useState('Draft a simulated MNQ long at 19000 with a 10 point stop, risk 100 dollars, 2R.');
  const [voiceStatus, setVoiceStatus] = useState('');
  const [voiceBusy, setVoiceBusy] = useState(false);

  const tradePending = useMemo(
    () => pending.filter(a => a.action === 'trade_plan' && a.agent === 'sigma-risk'),
    [pending],
  );
  const tradeHistory = useMemo(
    () => history.filter(a => a.action === 'trade_plan' && a.agent === 'sigma-risk').slice(0, 12),
    [history],
  );

  const load = useCallback(async () => {
    const [pendingRes, historyRes] = await Promise.all([
      fetch(`${API}/approvals`, { headers: headers(), credentials: 'include' }).then(r => r.json()),
      fetch(`${API}/approvals/history`, { headers: headers(), credentials: 'include' }).then(r => r.json()),
    ]);
    setPending(Array.isArray(pendingRes) ? pendingRes : []);
    setHistory(Array.isArray(historyRes) ? historyRes.filter((a: Approval) => a.status !== 'pending') : []);
    setLoading(false);
  }, []);

  useEffect(() => {
    load();
    const timer = setInterval(load, 5000);
    return () => clearInterval(timer);
  }, [load]);

  async function sendSimulatedAlert() {
    setSubmitting(true);
    setResult(null);
    try {
      const body: Record<string, unknown> = {
        symbol,
        side,
        entry: fieldNumber(entry),
        stopPoints: fieldNumber(stopPoints),
        rrRatio: fieldNumber(rrRatio),
        accountSize: fieldNumber(accountSize),
        riskDollars: fieldNumber(riskDollars),
        submittedBy: 'dashboard',
      };
      if (dailyLossDollars.trim()) {
        body.dailyLossDollars = fieldNumber(dailyLossDollars);
        body.maxDailyLossPct = 2;
      }

      const response = await fetch(`${API}/trading/simulated-alert`, {
        method: 'POST',
        headers: headers(),
        credentials: 'include',
        body: JSON.stringify(body),
      });
      const data = await response.json();
      setResult({
        approvalId: data.approvalId,
        plan: data.plan,
        error: response.ok ? undefined : data.error ?? data.blockReasons?.join(', ') ?? 'Alert rejected',
        status: response.status,
      });
      await load();
    } catch (err) {
      setResult({ error: err instanceof Error ? err.message : String(err) });
    } finally {
      setSubmitting(false);
    }
  }

  async function startRecording() {
    setVoiceStatus('');
    chunksRef.current = [];
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    const recorder = new MediaRecorder(stream);
    recorderRef.current = recorder;
    recorder.ondataavailable = event => {
      if (event.data.size > 0) chunksRef.current.push(event.data);
    };
    recorder.onstop = () => {
      const blob = new Blob(chunksRef.current, { type: recorder.mimeType || 'audio/webm' });
      setAudioBlob(blob);
      stream.getTracks().forEach(track => track.stop());
    };
    recorder.start();
    setRecording(true);
  }

  function stopRecording() {
    recorderRef.current?.stop();
    recorderRef.current = null;
    setRecording(false);
  }

  async function transcribeVoiceTrade() {
    if (!audioBlob) {
      setVoiceStatus('record audio first');
      return;
    }
    setVoiceBusy(true);
    setVoiceStatus('transcribing');
    try {
      const audioBase64 = await blobToBase64(audioBlob);
      const response = await fetch('/api/v1/voice/transcribe', {
        method: 'POST',
        headers: headers(),
        credentials: 'include',
        body: JSON.stringify({ audioBase64, mimeType: audioBlob.type || 'audio/webm' }),
      });
      const data = await response.json() as TranscriptionResult;
      if (!response.ok) throw new Error(data.error ?? 'transcription failed');
      setVoiceTranscript(data.text);
      setVoiceStatus(`${data.provider} / ${data.model} / ${data.latencyMs}ms`);
    } catch (err) {
      setVoiceStatus(err instanceof Error ? err.message : 'transcription failed');
    } finally {
      setVoiceBusy(false);
    }
  }

  async function draftVoiceTrade() {
    const transcript = voiceTranscript.trim();
    if (!transcript) {
      setVoiceStatus('transcript required');
      return;
    }
    setVoiceBusy(true);
    setResult(null);
    setVoiceStatus('drafting trade plan');
    try {
      const response = await fetch('/api/v1/voice/draft-simulated-trade', {
        method: 'POST',
        headers: headers(),
        credentials: 'include',
        body: JSON.stringify({
          transcript,
          accountSize: fieldNumber(accountSize),
          riskDollars: fieldNumber(riskDollars),
          rrRatio: fieldNumber(rrRatio),
        }),
      });
      const data = await response.json();
      setResult({
        approvalId: data.approvalId,
        plan: data.plan,
        error: response.ok ? undefined : data.error ?? data.blockReasons?.join(', ') ?? 'Voice draft rejected',
        status: response.status,
      });
      setVoiceStatus(response.ok ? `queued ${data.approvalId}` : data.code ?? 'rejected');
      await load();
    } catch (err) {
      setVoiceStatus(err instanceof Error ? err.message : 'voice draft failed');
    } finally {
      setVoiceBusy(false);
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-lg font-semibold" style={{ color: 'var(--text)' }}>Trading Ops</h1>
          <p className="text-xs mt-0.5" style={{ color: 'var(--subtext)' }}>
            {loading ? 'Loading...' : `${tradePending.length} pending trade plans`}
          </p>
        </div>
        <button onClick={load} className="btn-ghost">Refresh</button>
      </div>

      <div className="grid gap-4 lg:grid-cols-[420px_1fr]">
        <section className="sigma-panel p-4">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-sm font-semibold" style={{ color: 'var(--text)' }}>Simulated Alert</h2>
            <Badge value="approval_only" tone="green" />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <Field label="Symbol">
              <select value={symbol} onChange={event => setSymbol(event.target.value)} className="sigma-input">
                {['MNQ', 'MES', 'NQ', 'ES'].map(value => <option key={value} value={value}>{value}</option>)}
              </select>
            </Field>
            <Field label="Side">
              <select value={side} onChange={event => setSide(event.target.value as Side)} className="sigma-input">
                <option value="long">LONG</option>
                <option value="short">SHORT</option>
              </select>
            </Field>
            <Field label="Entry">
              <Input value={entry} onChange={setEntry} />
            </Field>
            <Field label="Stop Pts">
              <Input value={stopPoints} onChange={setStopPoints} />
            </Field>
            <Field label="R:R">
              <Input value={rrRatio} onChange={setRrRatio} />
            </Field>
            <Field label="Risk $">
              <Input value={riskDollars} onChange={setRiskDollars} />
            </Field>
            <Field label="Account $">
              <Input value={accountSize} onChange={setAccountSize} />
            </Field>
            <Field label="Daily Loss $">
              <Input value={dailyLossDollars} onChange={setDailyLossDollars} />
            </Field>
          </div>

          <button onClick={sendSimulatedAlert} disabled={submitting} className="btn-primary mt-4 w-full">
            {submitting ? 'Sending...' : 'Send Test Alert'}
          </button>

          {result && (
            <div className="mt-4 border-t pt-4" style={{ borderColor: 'var(--border)' }}>
              {result.error ? (
                <div className="text-sm" style={{ color: 'var(--red)' }}>{result.error}</div>
              ) : (
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-xs uppercase tracking-wider" style={{ color: 'var(--subtext)' }}>Queued</span>
                    <Badge value={String(result.status ?? 202)} tone="green" />
                  </div>
                  <div className="mono text-xs break-all" style={{ color: 'var(--muted)' }}>{result.approvalId}</div>
                  {result.plan && (
                    <div className="grid grid-cols-2 gap-2 pt-2 text-xs">
                      <div style={{ color: 'var(--subtext)' }}>Contracts</div>
                      <div className="mono text-right" style={{ color: 'var(--text)' }}>{result.plan.contracts}</div>
                      <div style={{ color: 'var(--subtext)' }}>Stop</div>
                      <div className="mono text-right" style={{ color: 'var(--text)' }}>{result.plan.stop}</div>
                      <div style={{ color: 'var(--subtext)' }}>Target</div>
                      <div className="mono text-right" style={{ color: 'var(--text)' }}>{result.plan.target}</div>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          <div className="mt-5 border-t pt-4" style={{ borderColor: 'var(--border)' }}>
            <div className="flex items-center justify-between mb-3">
              <div>
                <h2 className="text-sm font-semibold" style={{ color: 'var(--text)' }}>Nova Voice Draft</h2>
                <p className="text-xs mt-0.5" style={{ color: 'var(--muted)' }}>Speak or paste a simulated trade idea.</p>
              </div>
              <Badge value="nova_voice" tone="blue" />
            </div>

            <div className="flex flex-wrap gap-2 mb-3">
              <button
                onClick={recording ? stopRecording : startRecording}
                disabled={voiceBusy}
                className="btn-ghost"
                style={{ color: recording ? 'var(--red)' : 'var(--text)' }}>
                {recording ? 'Stop' : 'Record'}
              </button>
              <button onClick={transcribeVoiceTrade} disabled={voiceBusy || recording || !audioBlob} className="btn-ghost">
                Transcribe
              </button>
              <button onClick={draftVoiceTrade} disabled={voiceBusy || recording} className="btn-primary">
                Draft From Voice
              </button>
            </div>

            <textarea
              value={voiceTranscript}
              onChange={event => setVoiceTranscript(event.target.value)}
              rows={4}
              className="sigma-input"
              style={{ resize: 'vertical', fontFamily: 'var(--font-mono)' }}
            />
            {voiceStatus && (
              <div className="mono text-xs mt-2" style={{ color: voiceStatus.includes('failed') || voiceStatus.includes('required') || voiceStatus.includes('rejected') ? 'var(--red)' : 'var(--muted)' }}>
                {voiceStatus}
              </div>
            )}
          </div>
        </section>

        <section className="space-y-4">
          <div className="grid grid-cols-3 gap-3">
            <div className="sigma-panel p-3">
              <div className="text-xs uppercase tracking-wider" style={{ color: 'var(--subtext)' }}>Pending</div>
              <div className="mono text-xl mt-1" style={{ color: 'var(--blue)' }}>{tradePending.length}</div>
            </div>
            <div className="sigma-panel p-3">
              <div className="text-xs uppercase tracking-wider" style={{ color: 'var(--subtext)' }}>Resolved</div>
              <div className="mono text-xl mt-1" style={{ color: 'var(--text)' }}>{tradeHistory.length}</div>
            </div>
            <div className="sigma-panel p-3">
              <div className="text-xs uppercase tracking-wider" style={{ color: 'var(--subtext)' }}>Mode</div>
              <div className="mono text-sm mt-2" style={{ color: 'var(--green)' }}>approval_only</div>
            </div>
          </div>

          <div className="sigma-panel overflow-hidden">
            <div className="px-4 py-3 border-b" style={{ borderColor: 'var(--border)' }}>
              <span className="text-xs font-medium uppercase tracking-wider" style={{ color: 'var(--subtext)' }}>
                Pending Trade Plans
              </span>
            </div>
            {tradePending.length === 0 ? (
              <div className="px-4 py-8 text-center text-xs" style={{ color: 'var(--muted)' }}>No pending trade plans</div>
            ) : (
              <table className="sigma-table">
                <thead>
                  <tr><th>Time</th><th>Source</th><th>Plan</th><th>Size</th><th>Stop / Target</th><th>Status</th><th></th></tr>
                </thead>
                <tbody>{tradePending.map(approval => <TradeRow key={approval.id} approval={approval} />)}</tbody>
              </table>
            )}
          </div>

          <div className="sigma-panel overflow-hidden">
            <div className="px-4 py-3 border-b" style={{ borderColor: 'var(--border)' }}>
              <span className="text-xs font-medium uppercase tracking-wider" style={{ color: 'var(--subtext)' }}>
                Recent Trade History
              </span>
            </div>
            {tradeHistory.length === 0 ? (
              <div className="px-4 py-8 text-center text-xs" style={{ color: 'var(--muted)' }}>No trade history yet</div>
            ) : (
              <table className="sigma-table">
                <thead>
                  <tr><th>Time</th><th>Source</th><th>Plan</th><th>Size</th><th>Stop / Target</th><th>Status</th><th></th></tr>
                </thead>
                <tbody>{tradeHistory.map(approval => <TradeRow key={approval.id} approval={approval} />)}</tbody>
              </table>
            )}
          </div>
        </section>
      </div>
    </div>
  );
}
