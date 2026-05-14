// core/sandbox/index.ts
// Slice 3d: sandboxed file writer for approved Sigma Dev artifacts.
//
// Rules enforced before every write:
//   - Path must be relative (no leading /)
//   - Path must not contain .. segments (no traversal)
//   - Resolved absolute path must be inside SIGMA_SANDBOX_PATH
//   - Sandbox directory is created automatically if missing
//   - Overwrite is blocked unless approval payload carries overwriteApproved: true
//
// Audit:
//   - SHA-256 checksum of artifact content stored before write
//   - SHA-256 checksum of written file stored after write
//   - Full record stored in sandbox_writes table
//
// Agents NEVER call this. Only core/runtime calls executeSandboxWrite().

import { createHash } from 'crypto';
import { mkdirSync, writeFileSync, readFileSync, existsSync } from 'fs';
import { resolve, join, normalize, isAbsolute } from 'path';
import { randomUUID } from 'crypto';
import { db } from '../db.js';

// ---------------------------------------------------------------------------
// DB schema - append-only audit log
// ---------------------------------------------------------------------------

db.exec(`
  CREATE TABLE IF NOT EXISTS sandbox_writes (
    id           TEXT PRIMARY KEY,
    approval_id  TEXT NOT NULL,
    action       TEXT NOT NULL,
    agent        TEXT NOT NULL,
    sandbox_path TEXT NOT NULL,
    checksum_pre TEXT NOT NULL,
    checksum_post TEXT,
    resolved_by  TEXT,
    written_at   TEXT NOT NULL,
    outcome      TEXT NOT NULL
  )
`);

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface SandboxWriteResult {
  id: string;
  approvalId: string;
  action: string;
  agent: string;
  sandboxPath: string;
  checksumPre: string;
  checksumPost: string;
  resolvedBy: string | undefined;
  writtenAt: string;
  outcome: 'written' | 'denied' | 'blocked';
}

export class SandboxViolationError extends Error {
  public readonly code: 'PATH_TRAVERSAL' | 'ABSOLUTE_PATH' | 'OUTSIDE_SANDBOX' | 'OVERWRITE_BLOCKED';
  constructor(
    message: string,
    code: 'PATH_TRAVERSAL' | 'ABSOLUTE_PATH' | 'OUTSIDE_SANDBOX' | 'OVERWRITE_BLOCKED',
  ) {
    super(message);
    this.name = 'SandboxViolationError';
    this.code = code;
  }
}

// ---------------------------------------------------------------------------
// Path resolution - raises SandboxViolationError on any violation
// ---------------------------------------------------------------------------

export function getSandboxRoot(): string {
  const raw = process.env.SIGMA_SANDBOX_PATH ?? './.sigma-sandbox';
  return resolve(raw);
}

export function resolveSandboxPath(filePath: string): string {
  // Block absolute paths
  if (isAbsolute(filePath)) {
    throw new SandboxViolationError(
      `[sandbox] absolute path rejected: ${filePath}`,
      'ABSOLUTE_PATH',
    );
  }

  // Block traversal components
  const normalized = normalize(filePath);
  if (normalized.startsWith('..') || normalized.includes(`/..`) || normalized.includes(`\\..`)) {
    throw new SandboxViolationError(
      `[sandbox] path traversal rejected: ${filePath}`,
      'PATH_TRAVERSAL',
    );
  }

  const sandboxRoot = getSandboxRoot();
  const resolved = resolve(join(sandboxRoot, normalized));

  // Final containment check - resolved path must be inside sandbox
  if (!resolved.startsWith(sandboxRoot + '/') && resolved !== sandboxRoot) {
    throw new SandboxViolationError(
      `[sandbox] path escapes sandbox root: ${resolved}`,
      'OUTSIDE_SANDBOX',
    );
  }

  return resolved;
}

// ---------------------------------------------------------------------------
// Checksum helper
// ---------------------------------------------------------------------------

function sha256(data: string): string {
  return createHash('sha256').update(data, 'utf8').digest('hex');
}

// ---------------------------------------------------------------------------
// Write-allowed actions
// ---------------------------------------------------------------------------

const WRITE_ACTIONS = new Set([
  'scaffold_file',
  'write_docs',
  'generate_code',
  'refactor_code',
]);

// ---------------------------------------------------------------------------
// Core write function - called by runtime ONLY after approval is resolved
// ---------------------------------------------------------------------------

export function executeSandboxWrite(
  approvalId: string,
  action: string,
  agent: string,
  filePath: string,
  content: string,
  resolvedBy: string | undefined,
  overwriteApproved = false,
): SandboxWriteResult {
  const now = new Date().toISOString();
  const id = randomUUID();

  // Only allowed actions may write
  if (!WRITE_ACTIONS.has(action)) {
    throw new SandboxViolationError(
      `[sandbox] action '${action}' is not permitted to write files`,
      'OUTSIDE_SANDBOX',
    );
  }

  // Checksum content before write
  const checksumPre = sha256(content);

  // Validate and resolve the path - throws SandboxViolationError on violation
  const absPath = resolveSandboxPath(filePath);
  const sandboxRoot = getSandboxRoot();
  const relPath = absPath.slice(sandboxRoot.length + 1);

  // Block overwrite unless explicitly approved
  if (existsSync(absPath) && !overwriteApproved) {
    // Log the blocked attempt
    db.run(
      `INSERT INTO sandbox_writes
         (id, approval_id, action, agent, sandbox_path, checksum_pre, checksum_post, resolved_by, written_at, outcome)
       VALUES (:id, :aid, :action, :agent, :path, :pre, :post, :by, :at, :outcome)`,
      {
        ':id': id, ':aid': approvalId, ':action': action, ':agent': agent,
        ':path': relPath, ':pre': checksumPre, ':post': '', ':by': resolvedBy ?? null,
        ':at': now, ':outcome': 'blocked',
      },
    );
    console.warn(`[sandbox] overwrite blocked path=${relPath} approvalId=${approvalId}`);
    throw new SandboxViolationError(
      `[sandbox] file already exists and overwriteApproved is not set: ${relPath}`,
      'OVERWRITE_BLOCKED',
    );
  }

  // Ensure sandbox directory exists (create recursively)
  const dir = absPath.substring(0, absPath.lastIndexOf('/'));
  mkdirSync(dir, { recursive: true });

  // Write file
  writeFileSync(absPath, content, 'utf8');

  // Checksum written file for audit integrity
  const writtenContent = readFileSync(absPath, 'utf8');
  const checksumPost = sha256(writtenContent);

  // Persist audit record
  db.run(
    `INSERT INTO sandbox_writes
       (id, approval_id, action, agent, sandbox_path, checksum_pre, checksum_post, resolved_by, written_at, outcome)
     VALUES (:id, :aid, :action, :agent, :path, :pre, :post, :by, :at, :outcome)`,
    {
      ':id': id, ':aid': approvalId, ':action': action, ':agent': agent,
      ':path': relPath, ':pre': checksumPre, ':post': checksumPost, ':by': resolvedBy ?? null,
      ':at': now, ':outcome': 'written',
    },
  );

  console.log(
    `[sandbox] written path=${relPath} approval=${approvalId} " +
    "checksum=${checksumPost.slice(0, 12)}... resolvedBy=${resolvedBy ?? 'unknown'}`,
  );

  return {
    id,
    approvalId,
    action,
    agent,
    sandboxPath: relPath,
    checksumPre,
    checksumPost,
    resolvedBy,
    writtenAt: now,
    outcome: 'written',
  };
}

// ---------------------------------------------------------------------------
// Audit log reader
// ---------------------------------------------------------------------------

export function getSandboxLog(): SandboxWriteResult[] {
  return db
    .all('SELECT * FROM sandbox_writes ORDER BY written_at DESC')
    .map(r => ({
      id:           r['id'] as string,
      approvalId:   r['approval_id'] as string,
      action:       r['action'] as string,
      agent:        r['agent'] as string,
      sandboxPath:  r['sandbox_path'] as string,
      checksumPre:  r['checksum_pre'] as string,
      checksumPost: (r['checksum_post'] ?? '') as string,
      resolvedBy:   r['resolved_by'] as string | undefined,
      writtenAt:    r['written_at'] as string,
      outcome:      r['outcome'] as 'written' | 'denied' | 'blocked',
    }));
}
