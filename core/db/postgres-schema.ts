export interface MigrationTable {
  name: string;
  columns: string[];
  conflictTarget: string[];
  orderBy?: string;
}

export const POSTGRES_SCHEMA_SQL = [
  `CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    username TEXT NOT NULL UNIQUE,
    email TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    salt TEXT NOT NULL,
    created_at TEXT NOT NULL
  )`,

  `CREATE TABLE IF NOT EXISTS sessions (
    token TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    created_at TEXT NOT NULL,
    expires_at TEXT NOT NULL,
    invalidated INTEGER NOT NULL DEFAULT 0
  )`,

  `CREATE TABLE IF NOT EXISTS workspaces (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    slug TEXT NOT NULL UNIQUE,
    "createdAt" TEXT NOT NULL
  )`,

  `CREATE TABLE IF NOT EXISTS workspace_members (
    id TEXT PRIMARY KEY,
    "workspaceId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    role TEXT NOT NULL CHECK(role IN ('viewer', 'approver', 'admin')),
    "createdAt" TEXT NOT NULL,
    UNIQUE("workspaceId", "userId")
  )`,

  `CREATE TABLE IF NOT EXISTS approvals (
    id TEXT PRIMARY KEY,
    agent TEXT NOT NULL,
    action TEXT NOT NULL,
    description TEXT NOT NULL,
    payload TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending',
    created_at TEXT NOT NULL,
    resolved_at TEXT,
    resolved_by TEXT,
    reason TEXT
  )`,

  `CREATE TABLE IF NOT EXISTS outcome_log (
    id TEXT PRIMARY KEY,
    approval_id TEXT NOT NULL,
    task_type TEXT NOT NULL,
    agent TEXT NOT NULL,
    outcome TEXT NOT NULL,
    resolved_by TEXT,
    reason TEXT,
    logged_at TEXT NOT NULL
  )`,

  `CREATE TABLE IF NOT EXISTS memory (
    namespace TEXT NOT NULL,
    key TEXT NOT NULL,
    value TEXT NOT NULL,
    written_by TEXT NOT NULL,
    written_at TEXT NOT NULL,
    PRIMARY KEY (namespace, key)
  )`,

  `CREATE TABLE IF NOT EXISTS strategies (
    id TEXT PRIMARY KEY,
    "workspaceId" TEXT NOT NULL,
    name TEXT NOT NULL,
    slug TEXT NOT NULL,
    description TEXT,
    "propFirmTemplate" TEXT NOT NULL DEFAULT 'custom',
    "maxDailyDrawdown" REAL NOT NULL,
    "maxPositionSize" INTEGER NOT NULL,
    "allowedInstruments" TEXT NOT NULL,
    "defaultRR" REAL NOT NULL DEFAULT 2.0,
    status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active', 'archived')),
    "createdAt" TEXT NOT NULL,
    "updatedAt" TEXT NOT NULL,
    UNIQUE("workspaceId", slug)
  )`,

  `CREATE TABLE IF NOT EXISTS journal_entries (
    id TEXT PRIMARY KEY,
    "workspaceId" TEXT NOT NULL,
    "strategyId" TEXT,
    symbol TEXT NOT NULL,
    side TEXT NOT NULL CHECK(side IN ('long', 'short')),
    "entryPrice" REAL NOT NULL,
    "exitPrice" REAL,
    contracts INTEGER NOT NULL,
    "pnlDollars" REAL,
    outcome TEXT NOT NULL DEFAULT 'open' CHECK(outcome IN ('open', 'win', 'loss', 'scratch')),
    notes TEXT,
    tags TEXT,
    "openedAt" TEXT NOT NULL,
    "closedAt" TEXT
  )`,

  `CREATE TABLE IF NOT EXISTS paper_orders (
    id TEXT PRIMARY KEY,
    approval_id TEXT NOT NULL,
    symbol TEXT NOT NULL,
    side TEXT NOT NULL,
    quantity REAL NOT NULL,
    entry REAL NOT NULL,
    stop REAL NOT NULL,
    target REAL NOT NULL,
    mode TEXT NOT NULL,
    broker_adapter TEXT NOT NULL,
    resolved_by TEXT,
    simulated_fill REAL,
    submitted_at TEXT NOT NULL,
    outcome TEXT NOT NULL
  )`,

  `CREATE TABLE IF NOT EXISTS sandbox_writes (
    id TEXT PRIMARY KEY,
    approval_id TEXT NOT NULL,
    action TEXT NOT NULL,
    agent TEXT NOT NULL,
    sandbox_path TEXT NOT NULL,
    checksum_pre TEXT NOT NULL,
    checksum_post TEXT,
    resolved_by TEXT,
    written_at TEXT NOT NULL,
    outcome TEXT NOT NULL
  )`,
];

export const MIGRATION_TABLES: MigrationTable[] = [
  { name: 'users', columns: ['id', 'username', 'email', 'password_hash', 'salt', 'created_at'], conflictTarget: ['id'], orderBy: 'created_at ASC' },
  { name: 'sessions', columns: ['token', 'user_id', 'created_at', 'expires_at', 'invalidated'], conflictTarget: ['token'], orderBy: 'created_at ASC' },
  { name: 'workspaces', columns: ['id', 'name', 'slug', 'createdAt'], conflictTarget: ['id'], orderBy: '"createdAt" ASC' },
  { name: 'workspace_members', columns: ['id', 'workspaceId', 'userId', 'role', 'createdAt'], conflictTarget: ['id'], orderBy: '"createdAt" ASC' },
  { name: 'approvals', columns: ['id', 'agent', 'action', 'description', 'payload', 'status', 'created_at', 'resolved_at', 'resolved_by', 'reason'], conflictTarget: ['id'], orderBy: 'created_at ASC' },
  { name: 'outcome_log', columns: ['id', 'approval_id', 'task_type', 'agent', 'outcome', 'resolved_by', 'reason', 'logged_at'], conflictTarget: ['id'], orderBy: 'logged_at ASC' },
  { name: 'memory', columns: ['namespace', 'key', 'value', 'written_by', 'written_at'], conflictTarget: ['namespace', 'key'], orderBy: 'namespace ASC, key ASC' },
  { name: 'strategies', columns: ['id', 'workspaceId', 'name', 'slug', 'description', 'propFirmTemplate', 'maxDailyDrawdown', 'maxPositionSize', 'allowedInstruments', 'defaultRR', 'status', 'createdAt', 'updatedAt'], conflictTarget: ['id'], orderBy: '"createdAt" ASC' },
  { name: 'journal_entries', columns: ['id', 'workspaceId', 'strategyId', 'symbol', 'side', 'entryPrice', 'exitPrice', 'contracts', 'pnlDollars', 'outcome', 'notes', 'tags', 'openedAt', 'closedAt'], conflictTarget: ['id'], orderBy: '"openedAt" ASC' },
  { name: 'paper_orders', columns: ['id', 'approval_id', 'symbol', 'side', 'quantity', 'entry', 'stop', 'target', 'mode', 'broker_adapter', 'resolved_by', 'simulated_fill', 'submitted_at', 'outcome'], conflictTarget: ['id'], orderBy: 'submitted_at ASC' },
  { name: 'sandbox_writes', columns: ['id', 'approval_id', 'action', 'agent', 'sandbox_path', 'checksum_pre', 'checksum_post', 'resolved_by', 'written_at', 'outcome'], conflictTarget: ['id'], orderBy: 'written_at ASC' },
];

export function quoteIdent(identifier: string): string {
  return `"${identifier.replace(/"/g, '""')}"`;
}

