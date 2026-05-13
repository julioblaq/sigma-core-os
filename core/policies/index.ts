/**
 * core/policies/index.ts
   * Sigma Core OS — Policy & Approval Gate Engine
 *
   * Enforces human approval for sensitive or irreversible actions.
   * All agents MUST check policies before executing gated actions.
   */

export type ActionCategory =
  | 'trade_order'
  | 'money_movement'
  | 'file_delete'
  | 'file_overwrite_production'
  | 'deploy_production'
  | 'publish_public'
  | 'send_message'
  | 'custom';

export interface ApprovalRequest {
    id: string;
  agentName: string;
  actionCategory: ActionCategory;
  description: string;
  payload: Record<string, unknown>;
  requestedAt: Date;
  status: 'pending' | 'approved' | 'denied';
  resolvedAt?: Date;
  resolvedBy?: string;
}

// In-memory approval queue (replace with persistent store in production)
const approvalQueue: Map<string, ApprovalRequest> = new Map();

// Actions that ALWAYS require human approval
const GATED_ACTIONS: ActionCategory[] = [
  'trade_order',
  'money_movement',
  'file_delete',
  'file_overwrite_production',
  'deploy_production',
  'publish_public',
  'send_message',
];

export function requiresApproval(category: ActionCategory): boolean {
    return GATED_ACTIONS.includes(category);
}

export function requestApproval(
  agentName: string,
  actionCategory: ActionCategory,
  description: string,
  payload: Record<string, unknown>
): ApprovalRequest {
    const request: ApprovalRequest = {
    id: `approval-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    agentName,
    actionCategory,
    description,
    payload,
    requestedAt: new Date(),
    status: 'pending',
};

  approvalQueue.set(request.id, request);
  console.log(`[policies] Approval requested: ${request.id} by ${agentName} for ${actionCategory}`);

  // TODO: Emit event to dashboard / notification system
  return request;
                                   }

export function resolveApproval(
  requestId: string,
  approved: boolean,
  resolvedBy: string
): ApprovalRequest | null {
  const request = approvalQueue.get(requestId);
  if (!request) return null;

  request.status = approved ? 'approved' : 'denied';
  request.resolvedAt = new Date();
  request.resolvedBy = resolvedBy;

  console.log(`[policies] Approval ${request.status}: ${requestId} by ${resolvedBy}`);
  return request;
                                    }

export function getPendingApprovals(): ApprovalRequest[] {
  return Array.from(approvalQueue.values()).filter((r) => r.status === 'pending');
}

export function isApproved(requestId: string): boolean {
  const request = approvalQueue.get(requestId);
  return request?.status === 'approved' ?? false;
}
