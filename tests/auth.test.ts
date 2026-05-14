// tests/auth.test.ts
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'crypto';
import {
  register,
  login,
  logout,
  getSessionUser,
  AuthError,
} from '../core/auth/index.js';
import {
  createWorkspace,
  getMember,
} from '../core/operators/index.js';
import {
  requestApproval,
  resolveApproval,
} from '../core/policies/index.js';
import { logOutcome } from '../core/runtime/index.js';

// RUN suffix prevents collision on persistent sigma.db across test runs
const RUN = randomBytes(4).toString('hex');

function uid(name: string): string {
  return `${name}-${RUN}`;
}

describe('register', () => {
  it('creates a new user and returns user object', async () => {
    const user = await register(uid('testuser'), `${uid('test')}@example.com`, 'password123');
    assert.ok(user.id, 'user has id');
    assert.equal(user.username, uid('testuser'));
    assert.equal(user.email, `${uid('test')}@example.com`);
    assert.ok(user.createdAt, 'user has createdAt');
  });

  it('rejects duplicate username', async () => {
    await register(uid('dupuser'), `${uid('dup')}@example.com`, 'password123');
    await assert.rejects(
      () => register(uid('dupuser'), `${uid('dup2')}@example.com`, 'password123'),
      (err: AuthError) => {
        assert.equal(err.code, 'ALREADY_EXISTS');
        return true;
      },
    );
  });

  it('rejects short password', async () => {
    await assert.rejects(
      () => register(uid('shortpw'), `${uid('shortpw')}@example.com`, 'short'),
      (err: AuthError) => {
        assert.equal(err.code, 'INVALID_PASSWORD');
        return true;
      },
    );
  });

  it('rejects invalid email', async () => {
    await assert.rejects(
      () => register(uid('bademail'), 'notanemail', 'password123'),
      (err: AuthError) => {
        assert.equal(err.code, 'INVALID_EMAIL');
        return true;
      },
    );
  });
});

describe('login', () => {
  it('returns user and token for valid credentials', async () => {
    await register(uid('loginuser'), `${uid('loginuser')}@example.com`, 'goodpassword1');
    const { user, token } = await login(uid('loginuser'), 'goodpassword1');
    assert.equal(user.username, uid('loginuser'));
    assert.ok(token, 'token returned');
    assert.ok(token.length >= 32, 'token is at least 32 chars');
  });

  it('rejects wrong password', async () => {
    await register(uid('badpwuser'), `${uid('badpwuser')}@example.com`, 'correctpassword');
    await assert.rejects(
      () => login(uid('badpwuser'), 'wrongpassword'),
      (err: AuthError) => {
        assert.equal(err.code, 'INVALID_CREDENTIALS');
        return true;
      },
    );
  });

  it('rejects unknown username', async () => {
    await assert.rejects(
      () => login('nobody-' + RUN, 'anypassword'),
      (err: AuthError) => {
        assert.equal(err.code, 'INVALID_CREDENTIALS');
        return true;
      },
    );
  });
});

describe('getSessionUser', () => {
  it('returns user for valid token', async () => {
    await register(uid('sessuser'), `${uid('sessuser')}@example.com`, 'password123');
    const { token } = await login(uid('sessuser'), 'password123');
    const user = getSessionUser(token);
    assert.ok(user, 'user returned from valid session token');
    assert.equal(user!.username, uid('sessuser'));
  });

  it('returns null for unknown token', () => {
    const user = getSessionUser('deadbeef0000000000000000000000000000000000000000000000000000' + RUN);
    assert.equal(user, null);
  });

  it('returns null for undefined token', () => {
    const user = getSessionUser(undefined);
    assert.equal(user, null);
  });
});

describe('logout', () => {
  it('invalidates session token', async () => {
    await register(uid('logoutuser'), `${uid('logoutuser')}@example.com`, 'password123');
    const { token } = await login(uid('logoutuser'), 'password123');
    // Token is valid before logout
    assert.ok(getSessionUser(token), 'session valid before logout');
    logout(token);
    // Token is invalid after logout
    assert.equal(getSessionUser(token), null, 'session null after logout');
  });
});

describe('workspace access with authenticated user', () => {
  it('authenticated user id used as workspace creator', async () => {
    // Register a real user
    const user = await register(uid('wsowner'), `${uid('wsowner')}@example.com`, 'password123');
    assert.ok(user.id, 'user.id must be defined');
    // createWorkspace returns { workspace, member } — destructure correctly
    const { workspace } = createWorkspace(uid('My Auth WS'), user.id);
    // Verify the user is the admin member
    const member = getMember(workspace.id, user.id);
    assert.ok(member, 'user is workspace member');
    assert.equal(member!.role, 'admin');
  });

  it('approval resolved_by records authenticated user id', async () => {
    const user = await register(uid('approver'), `${uid('approver')}@example.com`, 'password123');
    const approval = requestApproval('sigma-risk', 'trade_plan', 'Test plan', { run: RUN });
    const resolved = resolveApproval(approval.id, true, user.id, undefined);
    assert.ok(resolved, 'approval resolved');
    assert.equal(resolved!.resolvedBy, user.id, 'resolvedBy is authenticated user id');
    const outcome = logOutcome(resolved!, 'trade_plan');
    assert.equal(outcome.resolvedBy, user.id, 'outcome log records authenticated user id');
  });
});
