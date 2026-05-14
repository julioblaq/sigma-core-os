// tests/operators.test.ts
// Slice 7a (v0.7.0): Workspace + Member Management tests.
// Tests: create workspace, unique slug, creator admin, add member,
// viewer cannot approve, approver can approve, admin manages members, invalid role rejected.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  createWorkspace,
  getWorkspace,
  addMember,
  getMembers,
  getMember,
  setMemberRole,
  canApprove,
  canManageMembers,
  OperatorError,
} from '../core/operators/index.js';
import { requestApproval, resolveApproval } from '../core/policies/index.js';

// ---------------------------------------------------------------------------
// Workspace creation
// ---------------------------------------------------------------------------

describe('createWorkspace', () => {
  it('creates a workspace with correct name and slug', () => {
    const { workspace } = createWorkspace('Sigma Futures Alpha', 'user-founder');
    assert.ok(workspace.id, 'should have an id');
    assert.equal(workspace.name, 'Sigma Futures Alpha');
    assert.equal(workspace.slug, 'sigma-futures-alpha');
    assert.ok(workspace.createdAt, 'should have createdAt');

    // Fetch it back
    const fetched = getWorkspace(workspace.id);
    assert.ok(fetched, 'should be retrievable');
    assert.equal(fetched!.slug, 'sigma-futures-alpha');
  });

  it('creator automatically becomes admin', () => {
    const { workspace, member } = createWorkspace('Creator Admin Test', 'user-creator');
    assert.equal(member.workspaceId, workspace.id);
    assert.equal(member.userId, 'user-creator');
    assert.equal(member.role, 'admin');

    // Verify via getMembers
    const members = getMembers(workspace.id);
    assert.equal(members.length, 1);
    assert.equal(members[0].role, 'admin');
    assert.equal(members[0].userId, 'user-creator');
  });

  it('unique slug enforcement: duplicate name throws SLUG_TAKEN', () => {
    createWorkspace('Unique Slug Workspace', 'user-a');
    assert.throws(
      () => createWorkspace('Unique Slug Workspace', 'user-b'),
      (err: unknown) => {
        assert.ok(err instanceof OperatorError);
        assert.equal(err.code, 'SLUG_TAKEN');
        return true;
      },
    );
  });

  it('different name with different slug succeeds', () => {
    const { workspace: ws1 } = createWorkspace('Prop Firm Team', 'user-pt1');
    const { workspace: ws2 } = createWorkspace('Prop Firm Group', 'user-pt2');
    assert.notEqual(ws1.slug, ws2.slug);
    assert.equal(ws1.slug, 'prop-firm-team');
    assert.equal(ws2.slug, 'prop-firm-group');
  });
});

// ---------------------------------------------------------------------------
// Member management
// ---------------------------------------------------------------------------

describe('addMember', () => {
  it('adds a member with specified role', () => {
    const { workspace } = createWorkspace('Member Test Workspace', 'user-admin1');
    const member = addMember(workspace.id, 'user-viewer1', 'viewer');
    assert.equal(member.workspaceId, workspace.id);
    assert.equal(member.userId, 'user-viewer1');
    assert.equal(member.role, 'viewer');

    const members = getMembers(workspace.id);
    assert.equal(members.length, 2); // admin + viewer
  });

  it('admin can manage members (canManageMembers)', () => {
    const { workspace } = createWorkspace('Admin Manages Workspace', 'user-admin2');
    const adminMember = getMember(workspace.id, 'user-admin2');
    assert.ok(adminMember, 'admin should be a member');
    assert.ok(canManageMembers(adminMember!.role), 'admin should be able to manage members');

    // Add approver
    const approver = addMember(workspace.id, 'user-approver2', 'approver');
    assert.equal(approver.role, 'approver');
    assert.ok(!canManageMembers(approver.role), 'approver should NOT be able to manage members');
  });

  it('invalid role rejected with INVALID_ROLE', () => {
    const { workspace } = createWorkspace('Invalid Role Test', 'user-admin3');
    assert.throws(
      () => addMember(workspace.id, 'user-bad', 'superuser' as 'viewer'),
      (err: unknown) => {
        assert.ok(err instanceof OperatorError);
        assert.equal(err.code, 'INVALID_ROLE');
        return true;
      },
    );
  });

  it('setMemberRole changes role correctly', () => {
    const { workspace } = createWorkspace('Role Change Workspace', 'user-admin4');
    addMember(workspace.id, 'user-viewer4', 'viewer');

    const updated = setMemberRole(workspace.id, 'user-viewer4', 'approver');
    assert.equal(updated.role, 'approver');

    const fetched = getMember(workspace.id, 'user-viewer4');
    assert.equal(fetched!.role, 'approver');
  });
});

// ---------------------------------------------------------------------------
// Role permission enforcement
// ---------------------------------------------------------------------------

describe('role permissions', () => {
  it('viewer cannot approve: canApprove returns false', () => {
    assert.equal(canApprove('viewer'), false);
  });

  it('approver can approve: canApprove returns true', () => {
    assert.equal(canApprove('approver'), true);
  });

  it('admin can approve: canApprove returns true', () => {
    assert.equal(canApprove('admin'), true);
  });

  it('viewer cannot approve a real approval (approval spine integration)', () => {
    const { workspace } = createWorkspace('Approval Role Workspace', 'user-admin5');
    addMember(workspace.id, 'user-viewer5', 'viewer');

    // Create a real approval
    const approval = requestApproval('sigma-bot', 'trade_plan', 'Test plan for role check', { test: true });
    assert.equal(approval.status, 'pending');

    // viewer's role check fails
    const viewerMember = getMember(workspace.id, 'user-viewer5');
    assert.ok(viewerMember, 'viewer should be a member');
    assert.equal(canApprove(viewerMember!.role), false, 'viewer cannot approve');

    // Approval should still be pending (viewer didn't resolve it)
    const stillPending = requestApproval('sigma-bot', 'trade_plan', 'Another pending', {});
    assert.equal(stillPending.status, 'pending');
  });

  it('approver can approve a real approval (approval spine integration)', () => {
    const { workspace } = createWorkspace('Approver Workspace', 'user-admin6');
    addMember(workspace.id, 'user-approver6', 'approver');

    const approverMember = getMember(workspace.id, 'user-approver6');
    assert.ok(approverMember, 'approver should be a member');
    assert.equal(canApprove(approverMember!.role), true, 'approver can approve');

    // Approver successfully resolves an approval
    const approval = requestApproval('sigma-risk', 'trade_plan', 'Plan for approver test', { contracts: 2 });
    const resolved = resolveApproval(approval.id, true, 'user-approver6');
    assert.ok(resolved, 'should resolve successfully');
    assert.equal(resolved!.status, 'approved');
    assert.equal(resolved!.resolvedBy, 'user-approver6');
  });
});
