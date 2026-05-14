// apps/dashboard/app/workspace/page.tsx
// Slice 7a (v0.7.0): Workspace page — name, slug, member table, role badges, add-member form.
// userId passed via x-user-id header (stub, no OAuth yet).
'use client';

import { useEffect, useState } from 'react';

const API = '/api';

const ROLE_COLORS: Record<string, string> = {
  admin: '#f59e0b',
  approver: '#60a5fa',
  viewer: '#6b7280',
};

const ROLE_BG: Record<string, string> = {
  admin: 'rgba(245,158,11,0.12)',
  approver: 'rgba(96,165,250,0.12)',
  viewer: 'rgba(107,114,128,0.12)',
};

interface Workspace {
  id: string;
  name: string;
  slug: string;
  createdAt: string;
}

interface Member {
  id: string;
  workspaceId: string;
  userId: string;
  role: string;
  createdAt: string;
}

export default function WorkspacePage() {
  const [workspaceId, setWorkspaceId] = useState('');
  const [workspace, setWorkspace] = useState<Workspace | null>(null);
  const [members, setMembers] = useState<Member[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  // Create workspace form
  const [createName, setCreateName] = useState('');
  const [userId, setUserId] = useState('julio');
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState('');

  // Add member form
  const [newUserId, setNewUserId] = useState('');
  const [newRole, setNewRole] = useState<'viewer' | 'approver' | 'admin'>('viewer');
  const [adding, setAdding] = useState(false);
  const [addError, setAddError] = useState('');

  async function loadWorkspace(id: string) {
    setLoading(true);
    setError('');
    try {
      const [wsRes, memRes] = await Promise.all([
        fetch(`${API}/v1/workspaces/${id}`),
        fetch(`${API}/v1/workspaces/${id}/members`),
      ]);
      if (!wsRes.ok) {
        setError('Workspace not found');
        setWorkspace(null);
        setMembers([]);
        return;
      }
      setWorkspace(await wsRes.json());
      setMembers(memRes.ok ? await memRes.json() : []);
    } catch {
      setError('Failed to load workspace');
    } finally {
      setLoading(false);
    }
  }

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    setCreating(true);
    setCreateError('');
    try {
      const res = await fetch(`${API}/v1/workspaces`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-user-id': userId },
        body: JSON.stringify({ name: createName }),
      });
      const data = await res.json();
      if (!res.ok) {
        setCreateError(data.error ?? 'Failed to create workspace');
        return;
      }
      setWorkspaceId(data.workspace.id);
      setWorkspace(data.workspace);
      setMembers([data.member]);
      setCreateName('');
    } catch {
      setCreateError('Network error');
    } finally {
      setCreating(false);
    }
  }

  async function handleAddMember(e: React.FormEvent) {
    e.preventDefault();
    if (!workspace) return;
    setAdding(true);
    setAddError('');
    try {
      const res = await fetch(`${API}/v1/workspaces/${workspace.id}/members`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-user-id': userId },
        body: JSON.stringify({ userId: newUserId, role: newRole }),
      });
      const data = await res.json();
      if (!res.ok) {
        setAddError(data.error ?? 'Failed to add member');
        return;
      }
      setMembers(prev => [...prev, data]);
      setNewUserId('');
    } catch {
      setAddError('Network error');
    } finally {
      setAdding(false);
    }
  }

  const iStyles = {
    background: 'var(--panel)',
    border: '1px solid var(--border)',
    color: 'var(--text)',
    borderRadius: 6,
    padding: '6px 10px',
    fontSize: 12,
    fontFamily: 'var(--font-mono)',
    outline: 'none',
    width: '100%',
  };

  const btnStyles = (accent?: boolean) => ({
    background: accent ? 'var(--accent)' : 'var(--panel)',
    border: `1px solid ${accent ? 'var(--accent)' : 'var(--border)'}`,
    color: accent ? '#fff' : 'var(--text)',
    borderRadius: 6,
    padding: '6px 14px',
    fontSize: 12,
    cursor: 'pointer',
    fontFamily: 'var(--font-mono)',
  });

  return (
    <main className="max-w-screen-xl mx-auto px-6 py-8 space-y-8">
      {/* Header */}
      <div>
        <h1 className="text-xl font-semibold" style={{ color: 'var(--text)' }}>Workspace</h1>
        <p className="text-xs mt-1" style={{ color: 'var(--muted)' }}>
          Multi-tenant workspace management — v0.7.0
        </p>
      </div>

      {/* Current user stub */}
      <div style={{ background: 'var(--panel)', border: '1px solid var(--border)', borderRadius: 8, padding: 16 }}>
        <p className="text-xs mono mb-2" style={{ color: 'var(--muted)' }}>Active User (stub — no OAuth yet)</p>
        <input
          value={userId}
          onChange={e => setUserId(e.target.value)}
          placeholder="your-user-id"
          style={{ ...iStyles, width: 240 }}
        />
        <p className="text-xs mt-1" style={{ color: 'var(--muted)' }}>
          This userId is sent as x-user-id header. Role enforcement is server-side.
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">

        {/* Create workspace */}
        <div style={{ background: 'var(--panel)', border: '1px solid var(--border)', borderRadius: 8, padding: 20 }}>
          <p className="text-sm font-medium mb-4" style={{ color: 'var(--text)' }}>Create Workspace</p>
          <form onSubmit={handleCreate} className="space-y-3">
            <div>
              <label className="text-xs mono block mb-1" style={{ color: 'var(--muted)' }}>Workspace Name</label>
              <input
                value={createName}
                onChange={e => setCreateName(e.target.value)}
                placeholder="e.g. Sigma Futures Alpha"
                required
                style={iStyles}
              />
              {createName && (
                <p className="text-xs mono mt-1" style={{ color: 'var(--muted)' }}>
                  slug: {createName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')}
                </p>
              )}
            </div>
            {createError && <p className="text-xs" style={{ color: 'var(--red)' }}>{createError}</p>}
            <button type="submit" disabled={creating} style={btnStyles(true)}>
              {creating ? 'Creating...' : 'Create Workspace'}
            </button>
          </form>
        </div>

        {/* Load workspace by ID */}
        <div style={{ background: 'var(--panel)', border: '1px solid var(--border)', borderRadius: 8, padding: 20 }}>
          <p className="text-sm font-medium mb-4" style={{ color: 'var(--text)' }}>Load Workspace by ID</p>
          <div className="space-y-3">
            <div>
              <label className="text-xs mono block mb-1" style={{ color: 'var(--muted)' }}>Workspace ID</label>
              <input
                value={workspaceId}
                onChange={e => setWorkspaceId(e.target.value)}
                placeholder="paste workspace UUID"
                style={iStyles}
              />
            </div>
            {error && <p className="text-xs" style={{ color: 'var(--red)' }}>{error}</p>}
            <button
              onClick={() => workspaceId && loadWorkspace(workspaceId)}
              disabled={loading || !workspaceId}
              style={btnStyles()}
            >
              {loading ? 'Loading...' : 'Load'}
            </button>
          </div>
        </div>
      </div>

      {/* Workspace detail */}
      {workspace && (
        <div style={{ background: 'var(--panel)', border: '1px solid var(--border)', borderRadius: 8, padding: 20 }}>
          <div className="flex items-start justify-between mb-6">
            <div>
              <h2 className="text-lg font-semibold" style={{ color: 'var(--text)' }}>{workspace.name}</h2>
              <p className="text-xs mono mt-0.5" style={{ color: 'var(--accent)' }}>/{workspace.slug}</p>
              <p className="text-xs mono mt-1" style={{ color: 'var(--muted)' }}>id: {workspace.id}</p>
            </div>
            <div className="text-right">
              <p className="text-xs mono" style={{ color: 'var(--muted)' }}>Created</p>
              <p className="text-xs mono" style={{ color: 'var(--text)' }}>
                {new Date(workspace.createdAt).toLocaleString()}
              </p>
            </div>
          </div>

          {/* Members table */}
          <div className="mb-6">
            <p className="text-xs mono mb-3 font-medium" style={{ color: 'var(--muted)' }}>
              MEMBERS — {members.length}
            </p>
            {members.length === 0 ? (
              <p className="text-xs" style={{ color: 'var(--muted)' }}>No members</p>
            ) : (
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr>
                    {['User ID', 'Role', 'Joined'].map(h => (
                      <th key={h} style={{
                        textAlign: 'left', fontSize: 10, color: 'var(--muted)',
                        fontFamily: 'var(--font-mono)', padding: '4px 8px',
                        borderBottom: '1px solid var(--border)',
                      }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {members.map(m => (
                    <tr key={m.id} style={{ borderBottom: '1px solid rgba(255,255,255,0.04)' }}>
                      <td style={{ padding: '8px 8px', fontSize: 12, fontFamily: 'var(--font-mono)', color: 'var(--text)' }}>
                        {m.userId}
                      </td>
                      <td style={{ padding: '8px 8px' }}>
                        <span style={{
                          display: 'inline-block', fontSize: 10, fontFamily: 'var(--font-mono)',
                          color: ROLE_COLORS[m.role] ?? 'var(--text)',
                          background: ROLE_BG[m.role] ?? 'transparent',
                          borderRadius: 4, padding: '2px 8px',
                          border: `1px solid ${ROLE_COLORS[m.role] ?? 'var(--border)'}33`,
                        }}>
                          {m.role.toUpperCase()}
                        </span>
                      </td>
                      <td style={{ padding: '8px 8px', fontSize: 11, fontFamily: 'var(--font-mono)', color: 'var(--muted)' }}>
                        {new Date(m.createdAt).toLocaleString()}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>

          {/* Add member form */}
          <div style={{ borderTop: '1px solid var(--border)', paddingTop: 16 }}>
            <p className="text-xs mono mb-3 font-medium" style={{ color: 'var(--muted)' }}>ADD MEMBER</p>
            <p className="text-xs mb-3" style={{ color: 'var(--muted)' }}>
              Requires admin role. Role enforcement is server-side via x-user-id header.
            </p>
            <form onSubmit={handleAddMember} className="flex gap-3 items-end flex-wrap">
              <div>
                <label className="text-xs mono block mb-1" style={{ color: 'var(--muted)' }}>User ID</label>
                <input
                  value={newUserId}
                  onChange={e => setNewUserId(e.target.value)}
                  placeholder="user-id to add"
                  required
                  style={{ ...iStyles, width: 200 }}
                />
              </div>
              <div>
                <label className="text-xs mono block mb-1" style={{ color: 'var(--muted)' }}>Role</label>
                <select
                  value={newRole}
                  onChange={e => setNewRole(e.target.value as typeof newRole)}
                  style={{ ...iStyles, width: 140 }}
                >
                  <option value="viewer">viewer</option>
                  <option value="approver">approver</option>
                  <option value="admin">admin</option>
                </select>
              </div>
              <div>
                <button type="submit" disabled={adding} style={btnStyles(true)}>
                  {adding ? 'Adding...' : 'Add Member'}
                </button>
              </div>
            </form>
            {addError && <p className="text-xs mt-2" style={{ color: 'var(--red)' }}>{addError}</p>}
          </div>
        </div>
      )}

      {/* Role reference */}
      <div style={{ background: 'var(--panel)', border: '1px solid var(--border)', borderRadius: 8, padding: 20 }}>
        <p className="text-xs mono mb-3 font-medium" style={{ color: 'var(--muted)' }}>ROLE PERMISSIONS</p>
        <div className="grid grid-cols-3 gap-4">
          {[
            { role: 'viewer', perms: ['Read approvals', 'Read logs', 'Read memory', 'Read workspace'] },
            { role: 'approver', perms: ['All viewer permissions', 'Approve actions', 'Deny actions (with reason)'] },
            { role: 'admin', perms: ['All approver permissions', 'Create workspaces', 'Add members', 'Set member roles'] },
          ].map(({ role, perms }) => (
            <div key={role} style={{ background: 'rgba(255,255,255,0.02)', borderRadius: 6, padding: 12 }}>
              <span style={{
                display: 'inline-block', fontSize: 10, fontFamily: 'var(--font-mono)',
                color: ROLE_COLORS[role], background: ROLE_BG[role],
                borderRadius: 4, padding: '2px 8px', marginBottom: 8,
                border: `1px solid ${ROLE_COLORS[role]}33`,
              }}>
                {role.toUpperCase()}
              </span>
              <ul className="space-y-1">
                {perms.map(p => (
                  <li key={p} className="text-xs" style={{ color: 'var(--muted)' }}>• {p}</li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </div>
    </main>
  );
}
