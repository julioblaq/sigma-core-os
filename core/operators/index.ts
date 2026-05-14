// core/operators/index.ts
// Slice 7a (v0.7.0): Workspace + Member Management.
// Multi-tenant operator layer for Sigma Core OS.
//
// Tables: workspaces, workspace_members
// Roles: viewer (read-only), approver (can resolve approvals), admin (full control)
//
// Rules:
// - slug must be unique (derived from name, enforced at DB level)
// - creator automatically becomes admin
// - role enforcement is server-side only
// - viewer cannot approve
// - approver can approve/deny
// - admin manages members and roles
// - userId is a stub string (no OAuth yet) — passed via x-user-id header

import { randomUUID } from 'crypto';
import { db } from '../db.js';

// ---------------------------------------------------------------------------
// Schema migration
// ---------------------------------------------------------------------------

export function migrateOperators(): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS workspaces (
      id          TEXT PRIMARY KEY,
      name        TEXT NOT NULL,
      slug        TEXT NOT NULL UNIQUE,
      createdAt   TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS workspace_members (
      id          TEXT PRIMARY KEY,
      workspaceId TEXT NOT NULL REFERENCES workspaces(id),
      userId      TEXT NOT NULL,
      role        TEXT NOT NULL CHECK(role IN ('viewer', 'approver', 'admin')),
      createdAt   TEXT NOT NULL,
      UNIQUE(workspaceId, userId)
    );
  `);
}

// Run migration on import
migrateOperators();

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type WorkspaceRole = 'viewer' | 'approver' | 'admin';

export interface Workspace {
  id: string;
  name: string;
  slug: string;
  createdAt: string;
}

export interface WorkspaceMember {
  id: string;
  workspaceId: string;
  userId: string;
  role: WorkspaceRole;
  createdAt: string;
}

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

export class OperatorError extends Error {
  public readonly code: string;
  constructor(code: string, message: string) {
    super(`[operators] ${message}`);
    this.name = 'OperatorError';
    this.code = code;
  }
}

// ---------------------------------------------------------------------------
// Slug generation
// ---------------------------------------------------------------------------

function toSlug(name: string): string {
  return name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

// ---------------------------------------------------------------------------
// Mappers
// ---------------------------------------------------------------------------

function orStr(v: unknown): string {
  return typeof v === 'string' ? v : String(v ?? '');
}

function rowToWorkspace(row: Record<string, unknown>): Workspace {
  return {
    id: orStr(row['id']),
    name: orStr(row['name']),
    slug: orStr(row['slug']),
    createdAt: orStr(row['createdAt']),
  };
}

function rowToMember(row: Record<string, unknown>): WorkspaceMember {
  return {
    id: orStr(row['id']),
    workspaceId: orStr(row['workspaceId']),
    userId: orStr(row['userId']),
    role: orStr(row['role']) as WorkspaceRole,
    createdAt: orStr(row['createdAt']),
  };
}

// ---------------------------------------------------------------------------
// createWorkspace
// Creator is automatically added as admin.
// ---------------------------------------------------------------------------

export function createWorkspace(name: string, createdBy: string): { workspace: Workspace; member: WorkspaceMember } {
  if (!name || name.trim().length === 0) {
    throw new OperatorError('INVALID_NAME', 'workspace name is required');
  }
  if (!createdBy || createdBy.trim().length === 0) {
    throw new OperatorError('INVALID_USER', 'createdBy userId is required');
  }

  const slug = toSlug(name);
  if (!slug) {
    throw new OperatorError('INVALID_NAME', 'workspace name produced an empty slug');
  }

  // Check slug uniqueness
  const existing = db.get('SELECT id FROM workspaces WHERE slug = :slug', { ':slug': slug });
  if (existing) {
    throw new OperatorError('SLUG_TAKEN', `workspace slug '${slug}' is already taken`);
  }

  const id = randomUUID();
  const now = new Date().toISOString();

  db.run(
    'INSERT INTO workspaces (id, name, slug, createdAt) VALUES (:id, :name, :slug, :createdAt)',
    { ':id': id, ':name': name.trim(), ':slug': slug, ':createdAt': now },
  );

  // Creator becomes admin automatically
  const memberId = randomUUID();
  db.run(
    'INSERT INTO workspace_members (id, workspaceId, userId, role, createdAt) VALUES (:id, :wid, :uid, :role, :createdAt)',
    { ':id': memberId, ':wid': id, ':uid': createdBy, ':role': 'admin', ':createdAt': now },
  );

  const workspace = rowToWorkspace(db.get('SELECT * FROM workspaces WHERE id = :id', { ':id': id })!);
  const member = rowToMember(db.get('SELECT * FROM workspace_members WHERE id = :id', { ':id': memberId })!);

  return { workspace, member };
}

// ---------------------------------------------------------------------------
// getWorkspace
// ---------------------------------------------------------------------------

export function getWorkspace(id: string): Workspace | undefined {
  const row = db.get('SELECT * FROM workspaces WHERE id = :id', { ':id': id });
  return row ? rowToWorkspace(row) : undefined;
}

export function getWorkspaceBySlug(slug: string): Workspace | undefined {
  const row = db.get('SELECT * FROM workspaces WHERE slug = :slug', { ':slug': slug });
  return row ? rowToWorkspace(row) : undefined;
}

// ---------------------------------------------------------------------------
// addMember
// Admin-only action (enforced in API layer, not here).
// Roles: viewer, approver, admin
// ---------------------------------------------------------------------------

export function addMember(workspaceId: string, userId: string, role: WorkspaceRole): WorkspaceMember {
  const workspace = getWorkspace(workspaceId);
  if (!workspace) {
    throw new OperatorError('WORKSPACE_NOT_FOUND', `workspace '${workspaceId}' not found`);
  }

  const validRoles: WorkspaceRole[] = ['viewer', 'approver', 'admin'];
  if (!validRoles.includes(role)) {
    throw new OperatorError('INVALID_ROLE', `role '${role}' is not valid. Must be one of: ${validRoles.join(', ')}`);
  }

  if (!userId || userId.trim().length === 0) {
    throw new OperatorError('INVALID_USER', 'userId is required');
  }

  // Check if already a member
  const existing = db.get(
    'SELECT id FROM workspace_members WHERE workspaceId = :wid AND userId = :uid',
    { ':wid': workspaceId, ':uid': userId },
  );
  if (existing) {
    throw new OperatorError('ALREADY_MEMBER', `user '${userId}' is already a member of this workspace`);
  }

  const id = randomUUID();
  const now = new Date().toISOString();

  db.run(
    'INSERT INTO workspace_members (id, workspaceId, userId, role, createdAt) VALUES (:id, :wid, :uid, :role, :createdAt)',
    { ':id': id, ':wid': workspaceId, ':uid': userId, ':role': role, ':createdAt': now },
  );

  return rowToMember(db.get('SELECT * FROM workspace_members WHERE id = :id', { ':id': id })!);
}

// ---------------------------------------------------------------------------
// getMembers
// ---------------------------------------------------------------------------

export function getMembers(workspaceId: string): WorkspaceMember[] {
  const workspace = getWorkspace(workspaceId);
  if (!workspace) {
    throw new OperatorError('WORKSPACE_NOT_FOUND', `workspace '${workspaceId}' not found`);
  }

  const rows = db.all(
    'SELECT * FROM workspace_members WHERE workspaceId = :wid ORDER BY createdAt ASC',
    { ':wid': workspaceId },
  );
  return rows.map(rowToMember);
}

// ---------------------------------------------------------------------------
// getMember - get a single member record
// ---------------------------------------------------------------------------

export function getMember(workspaceId: string, userId: string): WorkspaceMember | undefined {
  const row = db.get(
    'SELECT * FROM workspace_members WHERE workspaceId = :wid AND userId = :uid',
    { ':wid': workspaceId, ':uid': userId },
  );
  return row ? rowToMember(row) : undefined;
}

// ---------------------------------------------------------------------------
// setMemberRole
// Admin-only action (enforced in API layer).
// Cannot demote the last admin.
// ---------------------------------------------------------------------------

export function setMemberRole(workspaceId: string, userId: string, newRole: WorkspaceRole): WorkspaceMember {
  const workspace = getWorkspace(workspaceId);
  if (!workspace) {
    throw new OperatorError('WORKSPACE_NOT_FOUND', `workspace '${workspaceId}' not found`);
  }

  const validRoles: WorkspaceRole[] = ['viewer', 'approver', 'admin'];
  if (!validRoles.includes(newRole)) {
    throw new OperatorError('INVALID_ROLE', `role '${newRole}' is not valid`);
  }

  const member = getMember(workspaceId, userId);
  if (!member) {
    throw new OperatorError('MEMBER_NOT_FOUND', `user '${userId}' is not a member of this workspace`);
  }

  // Protect last admin
  if (member.role === 'admin' && newRole !== 'admin') {
    const adminCount = db.get(
      'SELECT COUNT(*) as c FROM workspace_members WHERE workspaceId = :wid AND role = :role',
      { ':wid': workspaceId, ':role': 'admin' },
    );
    if (Number(adminCount?.['c'] ?? 0) <= 1) {
      throw new OperatorError('LAST_ADMIN', 'cannot demote the last admin of a workspace');
    }
  }

  db.run(
    'UPDATE workspace_members SET role = :role WHERE workspaceId = :wid AND userId = :uid',
    { ':role': newRole, ':wid': workspaceId, ':uid': userId },
  );

  return rowToMember(db.get(
    'SELECT * FROM workspace_members WHERE workspaceId = :wid AND userId = :uid',
    { ':wid': workspaceId, ':uid': userId },
  )!);
}

// ---------------------------------------------------------------------------
// Role permission helpers
// ---------------------------------------------------------------------------

export function canApprove(role: WorkspaceRole): boolean {
  return role === 'approver' || role === 'admin';
}

export function canManageMembers(role: WorkspaceRole): boolean {
  return role === 'admin';
}
