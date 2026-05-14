'use client';
import { useEffect } from 'react';

type Approval = {
  id: string; agent: string; action: string; description: string;
  status: string; createdAt: string; resolvedAt?: string;
  resolvedBy?: string; reason?: string;
  payload?: Record<string, unknown>;
};

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="grid grid-cols-3 gap-4 py-2.5 border-b" style={{ borderColor: 'var(--border)' }}>
      <div className="text-xs font-medium uppercase tracking-wider" style={{ color: 'var(--subtext)' }}>{label}</div>
      <div className="col-span-2 text-xs" style={{ color: 'var(--text)' }}>{value}</div>
    </div>
  );
}

function Badge({ status }: { status: string }) {
  const cls = status === 'pending' ? 'badge-pending' : status === 'approved' ? 'badge-approved' : 'badge-denied';
  return <span className={`${cls} px-2 py-0.5 rounded text-xs font-mono uppercase`}>{status}</span>;
}

export default function ArtifactModal({ approval, onClose }: { approval: Approval; onClose: () => void }) {
  // Close on Escape
  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [onClose]);

  const artifact = approval.payload?.artifact as Record<string, unknown> | undefined;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-6"
      style={{ background: 'rgba(0,0,0,0.7)', backdropFilter: 'blur(4px)' }}
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="sigma-panel w-full max-w-3xl max-h-screen overflow-y-auto" style={{ maxHeight: '90vh' }}>
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b sticky top-0" style={{ background: 'var(--panel)', borderColor: 'var(--border)' }}>
          <div>
            <div className="flex items-center gap-2">
              <span className="mono text-xs px-1.5 py-0.5 rounded" style={{ background: 'rgba(245,158,11,0.1)', color: 'var(--accent)' }}>
                {approval.agent}
              </span>
              <span className="mono text-sm font-medium" style={{ color: 'var(--text)' }}>{approval.action}</span>
            </div>
            <div className="text-xs mt-1 mono" style={{ color: 'var(--muted)' }}>{approval.id}</div>
          </div>
          <button onClick={onClose} className="text-xl leading-none" style={{ color: 'var(--muted)' }}>×</button>
        </div>

        {/* Approval details */}
        <div className="px-6 py-4 border-b" style={{ borderColor: 'var(--border)' }}>
          <div className="text-xs font-medium uppercase tracking-wider mb-3" style={{ color: 'var(--subtext)' }}>Approval</div>
          <Row label="Status"      value={<Badge status={approval.status} />} />
          <Row label="Description" value={approval.description} />
          <Row label="Created"     value={<span className="mono">{new Date(approval.createdAt).toLocaleString()}</span>} />
          {approval.resolvedAt && <Row label="Resolved"   value={<span className="mono">{new Date(approval.resolvedAt).toLocaleString()}</span>} />}
          {approval.resolvedBy && <Row label="Resolved By" value={<span className="mono">{approval.resolvedBy}</span>} />}
          {approval.reason &&    <Row label="Reason"     value={<span style={{ color: 'var(--red)' }}>{approval.reason}</span>} />}
        </div>

        {/* Artifact */}
        {artifact && (
          <div className="px-6 py-4 border-b" style={{ borderColor: 'var(--border)' }}>
            <div className="text-xs font-medium uppercase tracking-wider mb-3" style={{ color: 'var(--subtext)' }}>Artifact</div>
            <Row label="Action"    value={<span className="mono">{String(artifact.action ?? '-')}</span>} />
            {artifact.filePath && <Row label="File Path" value={<span className="mono" style={{ color: 'var(--accent)' }}>{String(artifact.filePath)}</span>} />}
            {artifact.language && <Row label="Language"  value={<span className="mono">{String(artifact.language)}</span>} />}
            <Row label="Requires Write" value={<span className="mono">{artifact.requiresWrite ? 'yes' : 'no'}</span>} />
            <Row label="Generated" value={<span className="mono">{artifact.generatedAt ? new Date(String(artifact.generatedAt)).toLocaleString() : '-'}</span>} />
          </div>
        )}

        {/* Generated content */}
        {artifact?.content && (
          <div className="px-6 py-4 border-b" style={{ borderColor: 'var(--border)' }}>
            <div className="text-xs font-medium uppercase tracking-wider mb-3" style={{ color: 'var(--subtext)' }}>
              Generated Content
            </div>
            <pre className="mono text-xs p-4 rounded overflow-auto"
              style={{ background: 'var(--bg)', color: 'var(--text)', whiteSpace: 'pre-wrap', wordBreak: 'break-word', maxHeight: 320 }}>
              {String(artifact.content)}
            </pre>
          </div>
        )}

        {/* Raw payload */}
        <div className="px-6 py-4">
          <div className="text-xs font-medium uppercase tracking-wider mb-3" style={{ color: 'var(--subtext)' }}>Raw Payload</div>
          <pre className="mono text-xs p-4 rounded overflow-auto"
            style={{ background: 'var(--bg)', color: 'var(--muted)', whiteSpace: 'pre-wrap', wordBreak: 'break-word', maxHeight: 240 }}>
            {JSON.stringify(approval.payload, null, 2)}
          </pre>
        </div>
      </div>
    </div>
  );
}
