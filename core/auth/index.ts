// core/auth/index.ts
// Sigma Core OS — Auth module (v0.8.0)
// Users table + sessions table
// Password hashing via Node crypto scrypt (no external deps)
// Session tokens: 32-byte random hex stored in sessions table
// No OAuth, no JWT — opaque session tokens only

import { randomBytes, scrypt, timingSafeEqual } from 'crypto';
import { promisify } from 'util';
import { db } from '../db.js';

const scryptAsync = promisify(scrypt);

// ---------------------------------------------------------------------------
// Migration
// ---------------------------------------------------------------------------

export function migrateAuth(): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      username TEXT NOT NULL UNIQUE,
      email TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      salt TEXT NOT NULL,
      created_at TEXT NOT NULL
    )
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS sessions (
      token TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id),
      created_at TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      invalidated INTEGER NOT NULL DEFAULT 0
    )
  `);
}

migrateAuth();

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface User {
  id: string;
  username: string;
  email: string;
  createdAt: string;
}

export interface Session {
  token: string;
  userId: string;
  createdAt: string;
  expiresAt: string;
}

export class AuthError extends Error {
  constructor(
    message: string,
    public readonly code: string,
  ) {
    super(message);
    this.name = 'AuthError';
  }
}

// ---------------------------------------------------------------------------
// Password helpers
// ---------------------------------------------------------------------------

async function hashPassword(password: string, salt: string): Promise<string> {
  const buf = (await scryptAsync(password, salt, 64)) as Buffer;
  return buf.toString('hex');
}

// ---------------------------------------------------------------------------
// register — create a new user
// ---------------------------------------------------------------------------

export async function register(username: string, email: string, password: string): Promise<User> {
  if (!username || username.trim().length < 2) {
    throw new AuthError('username must be at least 2 characters', 'INVALID_USERNAME');
  }
  if (!email || !email.includes('@')) {
    throw new AuthError('invalid email address', 'INVALID_EMAIL');
  }
  if (!password || password.length < 8) {
    throw new AuthError('password must be at least 8 characters', 'INVALID_PASSWORD');
  }

  const existing = db.get('SELECT id FROM users WHERE username = :u OR email = :e', {
    ':u': username.trim().toLowerCase(),
    ':e': email.trim().toLowerCase(),
  });
  if (existing) {
    throw new AuthError('username or email already registered', 'ALREADY_EXISTS');
  }

  const id = randomBytes(16).toString('hex');
  const salt = randomBytes(16).toString('hex');
  const hash = await hashPassword(password, salt);
  const now = new Date().toISOString();
  const normalUsername = username.trim().toLowerCase();
  const normalEmail = email.trim().toLowerCase();

  db.run(
    `INSERT INTO users (id, username, email, password_hash, salt, created_at)
     VALUES (:id, :username, :email, :hash, :salt, :now)`,
    { ':id': id, ':username': normalUsername, ':email': normalEmail, ':hash': hash, ':salt': salt, ':now': now },
  );

  return { id, username: normalUsername, email: normalEmail, createdAt: now };
}

// ---------------------------------------------------------------------------
// login — verify credentials, create session
// ---------------------------------------------------------------------------

const SESSION_TTL_HOURS = 24;

export async function login(username: string, password: string): Promise<{ user: User; token: string }> {
  if (!username || !password) {
    throw new AuthError('username and password are required', 'MISSING_CREDENTIALS');
  }

  const row = db.get('SELECT * FROM users WHERE username = :u', {
    ':u': username.trim().toLowerCase(),
  });

  if (!row) {
    // Timing-safe: still hash even if no user found
    await hashPassword(password, 'deadbeef');
    throw new AuthError('invalid username or password', 'INVALID_CREDENTIALS');
  }

  const storedHash = row['password_hash'] as string;
  const salt = row['salt'] as string;
  const attemptHash = await hashPassword(password, salt);

  const storedBuf = Buffer.from(storedHash, 'hex');
  const attemptBuf = Buffer.from(attemptHash, 'hex');

  if (storedBuf.length !== attemptBuf.length || !timingSafeEqual(storedBuf, attemptBuf)) {
    throw new AuthError('invalid username or password', 'INVALID_CREDENTIALS');
  }

  const token = randomBytes(32).toString('hex');
  const now = new Date();
  const expiresAt = new Date(now.getTime() + SESSION_TTL_HOURS * 60 * 60 * 1000).toISOString();

  db.run(
    `INSERT INTO sessions (token, user_id, created_at, expires_at, invalidated)
     VALUES (:token, :uid, :now, :exp, 0)`,
    { ':token': token, ':uid': row['id'] as string, ':now': now.toISOString(), ':exp': expiresAt },
  );

  const user: User = {
    id: row['id'] as string,
    username: row['username'] as string,
    email: row['email'] as string,
    createdAt: row['created_at'] as string,
  };

  return { user, token };
}

// ---------------------------------------------------------------------------
// logout — invalidate session token
// ---------------------------------------------------------------------------

export function logout(token: string): void {
  db.run(
    'UPDATE sessions SET invalidated = 1 WHERE token = :token',
    { ':token': token },
  );
}

// ---------------------------------------------------------------------------
// getSessionUser — validate token, return user or null
// ---------------------------------------------------------------------------

export function getSessionUser(token: string | undefined): User | null {
  if (!token) return null;

  const session = db.get(
    `SELECT s.user_id, s.expires_at, s.invalidated,
            u.username, u.email, u.created_at
     FROM sessions s
     JOIN users u ON u.id = s.user_id
     WHERE s.token = :token`,
    { ':token': token },
  );

  if (!session) return null;
  if (session['invalidated'] as number === 1) return null;
  if (new Date(session['expires_at'] as string) < new Date()) return null;

  return {
    id: session['user_id'] as string,
    username: session['username'] as string,
    email: session['email'] as string,
    createdAt: session['created_at'] as string,
  };
}

// ---------------------------------------------------------------------------
// requireAuth — extract token from cookie or Authorization header
// Returns User or throws AuthError
// ---------------------------------------------------------------------------

export function extractToken(
  cookies: Record<string, string> | undefined,
  authHeader: string | undefined,
): string | undefined {
  // Cookie: sigma_session=<token>
  if (cookies?.['sigma_session']) return cookies['sigma_session'];
  // Authorization: Bearer <token>
  if (authHeader?.startsWith('Bearer ')) return authHeader.slice(7);
  return undefined;
}
