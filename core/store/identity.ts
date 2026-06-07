// Async identity/workspace store facade.
//
// SIGMA_CONTROL_STORE=postgres moves users, sessions, workspaces, and
// workspace_members to Postgres. Default behavior remains the existing
// SQLite-backed auth/operator modules.

import { randomBytes, randomUUID, scrypt, timingSafeEqual } from 'crypto';
import { promisify } from 'util';
import type { QueryResultRow } from 'pg';
import * as sqliteAuth from '../auth/index.js';
import * as sqliteOperators from '../operators/index.js';
import { AuthError, type User } from '../auth/index.js';
import {
  OperatorError,
  type Workspace,
  type WorkspaceMember,
  type WorkspaceRole,
} from '../operators/index.js';
import { query, usingPostgresControlStore, withPostgresClient } from './postgres.js';

const scryptAsync = promisify(scrypt);
const SESSION_TTL_HOURS = 24;

interface UserRow extends QueryResultRow {
  id: string;
  username: string;
  email: string;
  password_hash: string;
  salt: string;
  created_at: string;
}

interface SessionUserRow extends QueryResultRow {
  user_id: string;
  expires_at: string;
  invalidated: number;
  username: string;
  email: string;
  created_at: string;
}

interface WorkspaceRow extends QueryResultRow {
  id: string;
  name: string;
  slug: string;
  createdAt: string;
}

interface WorkspaceMemberRow extends QueryResultRow {
  id: string;
  workspaceId: string;
  userId: string;
  role: WorkspaceRole;
  createdAt: string;
}

interface CountRow extends QueryResultRow {
  c: string;
}

function toSlug(name: string): string {
  return name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

async function hashPassword(password: string, salt: string): Promise<string> {
  const buf = (await scryptAsync(password, salt, 64)) as Buffer;
  return buf.toString('hex');
}

function toUser(row: UserRow | SessionUserRow): User {
  return {
    id: 'id' in row ? row.id : row.user_id,
    username: row.username,
    email: row.email,
    createdAt: row.created_at,
  };
}

function toWorkspace(row: WorkspaceRow): Workspace {
  return {
    id: row.id,
    name: row.name,
    slug: row.slug,
    createdAt: row.createdAt,
  };
}

function toMember(row: WorkspaceMemberRow): WorkspaceMember {
  return {
    id: row.id,
    workspaceId: row.workspaceId,
    userId: row.userId,
    role: row.role,
    createdAt: row.createdAt,
  };
}

function assertRole(role: WorkspaceRole): void {
  const validRoles: WorkspaceRole[] = ['viewer', 'approver', 'admin'];
  if (!validRoles.includes(role)) {
    throw new OperatorError('INVALID_ROLE', `role '${role}' is not valid. Must be one of: ${validRoles.join(', ')}`);
  }
}

export async function register(username: string, email: string, password: string): Promise<User> {
  if (!usingPostgresControlStore()) return sqliteAuth.register(username, email, password);

  if (!username || username.trim().length < 2) {
    throw new AuthError('username must be at least 2 characters', 'INVALID_USERNAME');
  }
  if (!email || !email.includes('@')) {
    throw new AuthError('invalid email address', 'INVALID_EMAIL');
  }
  if (!password || password.length < 8) {
    throw new AuthError('password must be at least 8 characters', 'INVALID_PASSWORD');
  }

  const normalUsername = username.trim().toLowerCase();
  const normalEmail = email.trim().toLowerCase();
  const existing = await query<UserRow>(
    'SELECT * FROM users WHERE username = $1 OR email = $2',
    [normalUsername, normalEmail],
  );
  if (existing.rows.length > 0) {
    throw new AuthError('username or email already registered', 'ALREADY_EXISTS');
  }

  const id = randomBytes(16).toString('hex');
  const salt = randomBytes(16).toString('hex');
  const hash = await hashPassword(password, salt);
  const now = new Date().toISOString();
  const result = await query<UserRow>(
    `INSERT INTO users (id, username, email, password_hash, salt, created_at)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING *`,
    [id, normalUsername, normalEmail, hash, salt, now],
  );
  return toUser(result.rows[0]);
}

export async function login(username: string, password: string): Promise<{ user: User; token: string }> {
  if (!usingPostgresControlStore()) return sqliteAuth.login(username, password);
  if (!username || !password) {
    throw new AuthError('username and password are required', 'MISSING_CREDENTIALS');
  }

  const result = await query<UserRow>('SELECT * FROM users WHERE username = $1', [
    username.trim().toLowerCase(),
  ]);
  const row = result.rows[0];

  if (!row) {
    await hashPassword(password, 'deadbeef');
    throw new AuthError('invalid username or password', 'INVALID_CREDENTIALS');
  }

  const attemptHash = await hashPassword(password, row.salt);
  const storedBuf = Buffer.from(row.password_hash, 'hex');
  const attemptBuf = Buffer.from(attemptHash, 'hex');

  if (storedBuf.length !== attemptBuf.length || !timingSafeEqual(storedBuf, attemptBuf)) {
    throw new AuthError('invalid username or password', 'INVALID_CREDENTIALS');
  }

  const token = randomBytes(32).toString('hex');
  const now = new Date();
  const expiresAt = new Date(now.getTime() + SESSION_TTL_HOURS * 60 * 60 * 1000).toISOString();
  await query(
    `INSERT INTO sessions (token, user_id, created_at, expires_at, invalidated)
     VALUES ($1, $2, $3, $4, 0)`,
    [token, row.id, now.toISOString(), expiresAt],
  );

  return { user: toUser(row), token };
}

export async function logout(token: string): Promise<void> {
  if (!usingPostgresControlStore()) {
    sqliteAuth.logout(token);
    return;
  }
  await query('UPDATE sessions SET invalidated = 1 WHERE token = $1', [token]);
}

export async function getSessionUser(token: string | undefined): Promise<User | null> {
  if (!usingPostgresControlStore()) return sqliteAuth.getSessionUser(token);
  if (!token) return null;

  const result = await query<SessionUserRow>(
    `SELECT s.user_id, s.expires_at, s.invalidated,
            u.username, u.email, u.created_at
     FROM sessions s
     JOIN users u ON u.id = s.user_id
     WHERE s.token = $1`,
    [token],
  );
  const session = result.rows[0];
  if (!session) return null;
  if (Number(session.invalidated) === 1) return null;
  if (new Date(session.expires_at) < new Date()) return null;

  return toUser(session);
}

export function extractToken(
  cookies: Record<string, string> | undefined,
  authHeader: string | undefined,
): string | undefined {
  return sqliteAuth.extractToken(cookies, authHeader);
}

export async function createWorkspace(
  name: string,
  createdBy: string,
): Promise<{ workspace: Workspace; member: WorkspaceMember }> {
  if (!usingPostgresControlStore()) return sqliteOperators.createWorkspace(name, createdBy);
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

  return withPostgresClient(async (client) => {
    await client.query('BEGIN');
    try {
      const existing = await client.query<WorkspaceRow>('SELECT * FROM workspaces WHERE slug = $1', [slug]);
      if (existing.rows.length > 0) {
        throw new OperatorError('SLUG_TAKEN', `workspace slug '${slug}' is already taken`);
      }

      const id = randomUUID();
      const memberId = randomUUID();
      const now = new Date().toISOString();
      const workspaceResult = await client.query<WorkspaceRow>(
        `INSERT INTO workspaces (id, name, slug, "createdAt")
         VALUES ($1, $2, $3, $4)
         RETURNING *`,
        [id, name.trim(), slug, now],
      );
      const memberResult = await client.query<WorkspaceMemberRow>(
        `INSERT INTO workspace_members (id, "workspaceId", "userId", role, "createdAt")
         VALUES ($1, $2, $3, 'admin', $4)
         RETURNING *`,
        [memberId, id, createdBy, now],
      );
      await client.query('COMMIT');
      return {
        workspace: toWorkspace(workspaceResult.rows[0]),
        member: toMember(memberResult.rows[0]),
      };
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    }
  });
}

export async function getWorkspace(id: string): Promise<Workspace | undefined> {
  if (!usingPostgresControlStore()) return sqliteOperators.getWorkspace(id);
  const result = await query<WorkspaceRow>('SELECT * FROM workspaces WHERE id = $1', [id]);
  return result.rows[0] ? toWorkspace(result.rows[0]) : undefined;
}

export async function getWorkspaceBySlug(slug: string): Promise<Workspace | undefined> {
  if (!usingPostgresControlStore()) return sqliteOperators.getWorkspaceBySlug(slug);
  const result = await query<WorkspaceRow>('SELECT * FROM workspaces WHERE slug = $1', [slug]);
  return result.rows[0] ? toWorkspace(result.rows[0]) : undefined;
}

export async function addMember(
  workspaceId: string,
  userId: string,
  role: WorkspaceRole,
): Promise<WorkspaceMember> {
  if (!usingPostgresControlStore()) return sqliteOperators.addMember(workspaceId, userId, role);
  const workspace = await getWorkspace(workspaceId);
  if (!workspace) {
    throw new OperatorError('WORKSPACE_NOT_FOUND', `workspace '${workspaceId}' not found`);
  }
  assertRole(role);
  if (!userId || userId.trim().length === 0) {
    throw new OperatorError('INVALID_USER', 'userId is required');
  }

  const existing = await query<WorkspaceMemberRow>(
    'SELECT * FROM workspace_members WHERE "workspaceId" = $1 AND "userId" = $2',
    [workspaceId, userId],
  );
  if (existing.rows.length > 0) {
    throw new OperatorError('ALREADY_MEMBER', `user '${userId}' is already a member of this workspace`);
  }

  const result = await query<WorkspaceMemberRow>(
    `INSERT INTO workspace_members (id, "workspaceId", "userId", role, "createdAt")
     VALUES ($1, $2, $3, $4, $5)
     RETURNING *`,
    [randomUUID(), workspaceId, userId, role, new Date().toISOString()],
  );
  return toMember(result.rows[0]);
}

export async function getMembers(workspaceId: string): Promise<WorkspaceMember[]> {
  if (!usingPostgresControlStore()) return sqliteOperators.getMembers(workspaceId);
  const workspace = await getWorkspace(workspaceId);
  if (!workspace) {
    throw new OperatorError('WORKSPACE_NOT_FOUND', `workspace '${workspaceId}' not found`);
  }

  const result = await query<WorkspaceMemberRow>(
    'SELECT * FROM workspace_members WHERE "workspaceId" = $1 ORDER BY "createdAt" ASC',
    [workspaceId],
  );
  return result.rows.map(toMember);
}

export async function getMember(
  workspaceId: string,
  userId: string,
): Promise<WorkspaceMember | undefined> {
  if (!usingPostgresControlStore()) return sqliteOperators.getMember(workspaceId, userId);
  const result = await query<WorkspaceMemberRow>(
    'SELECT * FROM workspace_members WHERE "workspaceId" = $1 AND "userId" = $2',
    [workspaceId, userId],
  );
  return result.rows[0] ? toMember(result.rows[0]) : undefined;
}

export async function setMemberRole(
  workspaceId: string,
  userId: string,
  newRole: WorkspaceRole,
): Promise<WorkspaceMember> {
  if (!usingPostgresControlStore()) return sqliteOperators.setMemberRole(workspaceId, userId, newRole);
  const workspace = await getWorkspace(workspaceId);
  if (!workspace) {
    throw new OperatorError('WORKSPACE_NOT_FOUND', `workspace '${workspaceId}' not found`);
  }
  assertRole(newRole);

  const member = await getMember(workspaceId, userId);
  if (!member) {
    throw new OperatorError('MEMBER_NOT_FOUND', `user '${userId}' is not a member of this workspace`);
  }

  if (member.role === 'admin' && newRole !== 'admin') {
    const adminCount = await query<CountRow>(
      'SELECT COUNT(*) as c FROM workspace_members WHERE "workspaceId" = $1 AND role = $2',
      [workspaceId, 'admin'],
    );
    if (Number(adminCount.rows[0]?.c ?? 0) <= 1) {
      throw new OperatorError('LAST_ADMIN', 'cannot demote the last admin of a workspace');
    }
  }

  const result = await query<WorkspaceMemberRow>(
    `UPDATE workspace_members
     SET role = $1
     WHERE "workspaceId" = $2 AND "userId" = $3
     RETURNING *`,
    [newRole, workspaceId, userId],
  );
  return toMember(result.rows[0]);
}

export function canApprove(role: WorkspaceRole): boolean {
  return sqliteOperators.canApprove(role);
}

export function canManageMembers(role: WorkspaceRole): boolean {
  return sqliteOperators.canManageMembers(role);
}

export { AuthError, OperatorError };
export type { User, Workspace, WorkspaceMember, WorkspaceRole };
