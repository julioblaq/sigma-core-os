/**
 * core/runtime/index.ts
 * Logs final task outcomes after approval resolution.
 */

import { randomUUID } from 'crypto';
import { db } from '../db.js';
import type { Approval } from '../policies/index.js';

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
    const id  = randomUUID();
    const now = new Date().toISOString();
    db.run(
          `INSERT INTO outcome_log (id, approval_id, task_type, agent, outcome, resolved_by, logged_at)
               VALUES (:id, :aid, :type, :agent, :outcome, :by, :at)`,
      { ':id': id, ':aid': approval.id, ':type': taskType, ':agent': approval.agent,
             ':outcome': approval.status, ':by': approval.resolvedBy ?? null, ':at': now },
        );
    console.log(`[runtime] outcome=${approval.status}  approval=${approval.id}`);
    return {
          id, approvalId: approval.id, taskType, agent: approval.agent,
          outcome: approval.status as 'approved' | 'denied',
          resolvedBy: approval.resolvedBy, loggedAt: now,
    };
}

export function getLog(): OutcomeEntry[] {
    return db.all('SELECT * FROM outcome_log ORDER BY logged_at DESC').map(r => ({
          id:         r['id'] as string,
          approvalId: r['approval_id'] as string,
          taskType:   r['task_type'] as string,
          agent:      r['agent'] as string,
          outcome:    r['outcome'] as 'approved' | 'denied',
          resolvedBy: r['resolved_by'] as string | undefined,
          loggedAt:   r['logged_at'] as string,
    }));
}
