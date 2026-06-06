'use client';

import { useEffect, useRef, useState } from 'react';

interface VoiceConfig {
  provider: string;
  sttModel: string;
  ttsModel: string;
  ttsVoice: string;
  apiKeySet: boolean;
}

interface TranscriptionResult {
  text: string;
  provider: string;
  model: string;
  latencyMs: number;
}

interface DraftResult {
  approval?: { id: string; status: string; action: string };
}

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

function tokenHeaders(): Record<string, string> {
  const token = typeof window !== 'undefined' ? localStorage.getItem('sigma_token') : null;
  return token ? { Authorization: `Bearer ${token}` } : {};
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

export default function VoicePage() {
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<BlobPart[]>([]);
  const [config, setConfig] = useState<VoiceConfig | null>(null);
  const [recording, setRecording] = useState(false);
  const [audioBlob, setAudioBlob] = useState<Blob | null>(null);
  const [transcript, setTranscript] = useState('');
  const [taskType, setTaskType] = useState('voice_command');
  const [status, setStatus] = useState('');
  const [busy, setBusy] = useState(false);
  const [draftId, setDraftId] = useState('');
  const [audioUrl, setAudioUrl] = useState('');
  const [hermesConfig, setHermesConfig] = useState<HermesConfig | null>(null);
  const [hermesStatus, setHermesStatus] = useState<HermesStatus | null>(null);
  const [hermesModel, setHermesModel] = useState('');

  useEffect(() => {
    fetch('/api/v1/voice/config', { headers: tokenHeaders() })
      .then(r => r.json())
      .then(setConfig)
      .catch(() => setStatus('voice config unavailable'));

    Promise.all([
      fetch('/api/v1/hermes/config', { headers: tokenHeaders() }).then(r => r.json()),
      fetch('/api/v1/hermes/status', { headers: tokenHeaders() }).then(r => r.json()),
      fetch('/api/v1/hermes/models', { headers: tokenHeaders() }).then(r => r.json()),
    ])
      .then(([cfg, health, modelPayload]: [HermesConfig, HermesStatus, HermesModels]) => {
        setHermesConfig(cfg);
        setHermesStatus(health);
        setHermesModel(modelPayload.models?.[0]?.id ?? '');
      })
      .catch(() => {
        setHermesStatus({
          configured: false,
          ok: false,
          statusCode: null,
          latencyMs: 0,
          error: 'Hermes unavailable',
        });
      });
  }, []);

  async function startRecording() {
    setStatus('');
    setDraftId('');
    setAudioUrl('');
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

  async function transcribe() {
    if (!audioBlob) {
      setStatus('record audio first');
      return;
    }
    setBusy(true);
    setStatus('transcribing');
    try {
      const audioBase64 = await blobToBase64(audioBlob);
      const res = await fetch('/api/v1/voice/transcribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...tokenHeaders() },
        body: JSON.stringify({ audioBase64, mimeType: audioBlob.type || 'audio/webm' }),
      });
      const data = await res.json() as TranscriptionResult & { error?: string };
      if (!res.ok) throw new Error(data.error ?? 'transcription failed');
      setTranscript(data.text);
      setStatus(`${data.provider} / ${data.model} / ${data.latencyMs}ms`);
    } catch (err) {
      setStatus(err instanceof Error ? err.message : 'transcription failed');
    } finally {
      setBusy(false);
    }
  }

  async function queueDraft() {
    const clean = transcript.trim();
    if (!clean) {
      setStatus('transcript required');
      return;
    }
    setBusy(true);
    setStatus('queueing draft');
    try {
      const res = await fetch('/api/v1/voice/draft-task', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...tokenHeaders() },
        body: JSON.stringify({ transcript: clean, taskType }),
      });
      const data = await res.json() as DraftResult & { error?: string };
      if (!res.ok) throw new Error(data.error ?? 'draft failed');
      setDraftId(data.approval?.id ?? '');
      setStatus('draft queued');
    } catch (err) {
      setStatus(err instanceof Error ? err.message : 'draft failed');
    } finally {
      setBusy(false);
    }
  }

  async function speak() {
    const clean = transcript.trim();
    if (!clean) {
      setStatus('transcript required');
      return;
    }
    setBusy(true);
    setStatus('speaking');
    try {
      const res = await fetch('/api/v1/voice/speech', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...tokenHeaders() },
        body: JSON.stringify({ text: clean.slice(0, 800) }),
      });
      const data = await res.json() as { audioBase64?: string; mimeType?: string; error?: string };
      if (!res.ok || !data.audioBase64) throw new Error(data.error ?? 'speech failed');
      const byteCharacters = atob(data.audioBase64);
      const bytes = new Uint8Array(byteCharacters.length);
      for (let i = 0; i < byteCharacters.length; i++) bytes[i] = byteCharacters.charCodeAt(i);
      const url = URL.createObjectURL(new Blob([bytes], { type: data.mimeType ?? 'audio/mpeg' }));
      setAudioUrl(url);
      setStatus('voice ready');
    } catch (err) {
      setStatus(err instanceof Error ? err.message : 'speech failed');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-lg font-semibold text-sigma-text">Voice</h1>
          <p className="text-xs mt-0.5" style={{ color: 'var(--subtext)' }}>
            {config ? `${config.provider} / ${config.sttModel}` : 'loading'}
          </p>
        </div>
        <div className="mono text-xs" style={{ color: config?.apiKeySet ? 'var(--green)' : 'var(--red)' }}>
          {config?.apiKeySet ? 'key:set' : 'key:missing'}
        </div>
      </div>

      <section className="sigma-panel p-4 space-y-4">
        <div className="grid gap-3 md:grid-cols-3">
          <div className="rounded border p-3" style={{ borderColor: 'var(--border)', background: 'rgba(255,255,255,0.03)' }}>
            <div className="text-xs" style={{ color: 'var(--subtext)' }}>Hermes</div>
            <div className="mt-1 mono text-sm" style={{ color: hermesStatus?.ok ? 'var(--green)' : 'var(--red)' }}>
              {hermesStatus?.ok ? 'online' : 'offline'}
            </div>
          </div>
          <div className="rounded border p-3" style={{ borderColor: 'var(--border)', background: 'rgba(255,255,255,0.03)' }}>
            <div className="text-xs" style={{ color: 'var(--subtext)' }}>Model</div>
            <div className="mt-1 mono text-sm" style={{ color: 'var(--text)' }}>
              {hermesModel || hermesConfig?.model || 'unknown'}
            </div>
          </div>
          <div className="rounded border p-3" style={{ borderColor: 'var(--border)', background: 'rgba(255,255,255,0.03)' }}>
            <div className="text-xs" style={{ color: 'var(--subtext)' }}>Auth</div>
            <div className="mt-1 mono text-sm" style={{ color: hermesConfig?.apiKeySet ? 'var(--green)' : 'var(--red)' }}>
              {hermesConfig?.apiKeySet ? 'key:set' : 'key:missing'}
            </div>
          </div>
        </div>
        {hermesStatus?.error && (
          <div className="mono text-xs" style={{ color: 'var(--red)' }}>{hermesStatus.error}</div>
        )}

        <div className="flex flex-wrap items-center gap-2">
          <button
            onClick={recording ? stopRecording : startRecording}
            disabled={busy}
            className="text-xs px-3 py-2 rounded"
            style={{ background: recording ? 'var(--red)' : 'var(--accent)', color: recording ? '#fff' : '#000' }}>
            {recording ? 'Stop' : 'Record'}
          </button>
          <button
            onClick={transcribe}
            disabled={busy || recording || !audioBlob}
            className="text-xs px-3 py-2 rounded border"
            style={{ borderColor: 'var(--border)', color: 'var(--text)', opacity: busy || recording || !audioBlob ? 0.5 : 1 }}>
            Transcribe
          </button>
          <select
            value={taskType}
            onChange={e => setTaskType(e.target.value)}
            className="text-xs px-2 py-2 rounded border"
            style={{ background: 'var(--panel)', borderColor: 'var(--border)', color: 'var(--text)' }}>
            <option value="voice_command">voice_command</option>
            <option value="dev_task">dev_task</option>
            <option value="trade_plan">trade_plan</option>
          </select>
          <button
            onClick={queueDraft}
            disabled={busy || !transcript.trim()}
            className="text-xs px-3 py-2 rounded border"
            style={{ borderColor: 'var(--border)', color: 'var(--text)', opacity: busy || !transcript.trim() ? 0.5 : 1 }}>
            Queue Draft
          </button>
          <button
            onClick={speak}
            disabled={busy || !transcript.trim()}
            className="text-xs px-3 py-2 rounded border"
            style={{ borderColor: 'var(--border)', color: 'var(--text)', opacity: busy || !transcript.trim() ? 0.5 : 1 }}>
            Speak
          </button>
        </div>

        {audioBlob && (
          <audio controls src={URL.createObjectURL(audioBlob)} className="w-full" />
        )}

        <textarea
          value={transcript}
          onChange={e => setTranscript(e.target.value)}
          className="w-full min-h-48 text-sm mono rounded p-3"
          style={{
            background: 'rgba(255,255,255,0.04)',
            border: '1px solid var(--border)',
            color: 'var(--text)',
            resize: 'vertical',
          }}
          placeholder="Transcript"
        />

        <div className="flex items-center justify-between gap-4">
          <div className="mono text-xs" style={{ color: 'var(--muted)' }}>{status || 'idle'}</div>
          {draftId && (
            <a href={`/approvals`} className="mono text-xs" style={{ color: 'var(--accent)' }}>
              approval:{draftId.slice(0, 8)}
            </a>
          )}
        </div>

        {audioUrl && <audio controls autoPlay src={audioUrl} className="w-full" />}
      </section>
    </div>
  );
}
