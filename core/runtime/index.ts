/**
 * core/runtime/index.ts
 * Logs final task outcomes after approval resolution.
 * Backed by the same SQLite DB as policies and memory.
 */

import Database from 'better-sqlite3';
import path from 'path';
import type { Approval } from '../policies/index';

const DB_PATH = path.resolve(process.env.DB_PATH ?? './sigma.db');
const db = new Database(DB_PATH);

db.exec(`
  CREATE TABLE IF NOT EXISTS outcome_log (
      id           TEXT PRIMARY KEY,
          approval_id  TEXT NOT NULL,
              task_type    TEXT NOT NULL,
                  agent        TEXT NOT NULL,
                      outcome      TEXT NOT NULL,
                          resolved_by  TEXT,
                              logged_at    TEXT NOT NULL
                                )
                                `);

const insertLog = db.prepare(`
  INSERT INTO outcome_log (id, approval_id, task_type, agent, outcome, resolved_by, logged_at)
    VALUES (@id, @approval_id, @task_type, @agent, @outcome, @resolved_by, @logged_at)
    `);

const allLogs = db.prepare('SELECT * FROM outcome_log ORDER BY logged_at DESC');

export interface OutcomeEntry {
   id: string;
   approvalId: string;
   taskType: string;
   agent: string;
   outcome: 'approved' | 'denied';
   resolvedBy?: string;
   loggedAt: string;
}

export function logOutcome(approval: Approval, taskType: string): OutcomeEntry {
   const entry: OutcomeEntry = {
        id:          crypto.randomUUID(),
        approvalId:  approval.id,
        taskType,
        agent:       approval.agent,
        outcome:     approval.status as 'approved' | 'denied',
        resolvedBy:  approval.resolvedBy,
        loggedAt:    new Date().toISOString(),
   };
   insertLog.run({
        id:           entry.id,
        approval_id:  entry.approvalId,
        task_type:    entry.taskType,
        agent:        entry.agent,
        outcome:      entry.outcome,
        resolved_by:  entry.resolvedBy ?? null,
        logged_at:    entry.loggedAt,
   });
   console.log(`[runtime] outcome=${entry.outcome}  approval=${entry.approvalId}  agent=${entry.agent}`);
   return entry;
}

export function getLog(): OutcomeEntry[] {
   return (allLogs.all() as Record<string, string>[]).map(r => ({
        id:         r.id,
        approvalId: r.approval_id,
        taskType:   r.task_type,
        agent:      r.agent,
        outcome:    r.outcome as 'approved' | 'denied',
        resolvedBy: r.resolved_by ?? undefined,
        loggedAt:   r.logged_at,
   }));
}
