// Lightweight workspace/operator types with no database side effects.

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

export class OperatorError extends Error {
  public readonly code: string;
  constructor(code: string, message: string) {
    super(`[operators] ${message}`);
    this.name = 'OperatorError';
    this.code = code;
  }
}

export function canApprove(role: WorkspaceRole): boolean {
  return role === 'approver' || role === 'admin';
}

export function canManageMembers(role: WorkspaceRole): boolean {
  return role === 'admin';
}
