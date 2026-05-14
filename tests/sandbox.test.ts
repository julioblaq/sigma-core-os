// tests/sandbox.test.ts
// Slice 3d: sandboxed write tests.
// Uses os.tmpdir() as sandbox root - no repo files touched.
// Tests: approved write, denied write, path traversal, absolute path,
//        overwrite blocked, checksum logged, outside-sandbox blocked, immutability.

import { describe, it, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'crypto';
import { tmpdir } from 'os';
import { join } from 'path';
import { existsSync, readFileSync, rmSync } from 'fs';
import { createHash } from 'crypto';

// Point sandbox at a temp directory so tests never touch the real repo
const TEST_SANDBOX = join(tmpdir(), `sigma-sandbox-test-${Date.now()}`);

before(() => {
  process.env.SIGMA_SANDBOX_PATH = TEST_SANDBOX;
});

after(() => {
  // Clean up temp sandbox after all tests
  try { rmSync(TEST_SANDBOX, { recursive: true, force: true }); } catch { /* ignore */ }
});

import {
  executeSandboxWrite,
  resolveSandboxPath,
  getSandboxLog,
  getSandboxRoot,
  SandboxViolationError,
} from '../core/sandbox/index.js';
import { requestApproval, resolveApproval } from '../core/policies/index.js';
import { executeWrite } from '../core/runtime/index.js';

function sha256(s: string): string {
  return createHash('sha256').update(s, 'utf8').digest('hex');
}

function makeApproval(action: string, filePath: string, content: string, overwriteApproved = false) {
  const artifact = { action, filePath, content, requiresWrite: true, description: 'test', generatedAt: new Date().toISOString() };
  return requestApproval('sigma-dev', action, `test ${action}`, { artifact, overwriteApproved, taskId: randomUUID() });
}

// ---------------------------------------------------------------------------
// Path validation (no DB, no filesystem - pure logic)
// ---------------------------------------------------------------------------

describe('resolveSandboxPath', () => {
  it('resolves valid relative path inside sandbox', () => {
    const resolved = resolveSandboxPath('core/utils/foo.ts');
    assert.ok(resolved.startsWith(TEST_SANDBOX), 'resolved path must be inside sandbox');
    assert.ok(resolved.endsWith('core/utils/foo.ts'));
  });

  it('blocks path traversal with ..', () => {
    assert.throws(
      () => resolveSandboxPath('../etc/passwd'),
      (err: unknown) => {
        assert.ok(err instanceof SandboxViolationError);
        assert.equal(err.code, 'PATH_TRAVERSAL');
        return true;
      },
    );
  });

  it('blocks path traversal with embedded ..', () => {
    assert.throws(
      () => resolveSandboxPath('core/../../etc/passwd'),
      (err: unknown) => {
        assert.ok(err instanceof SandboxViolationError);
        assert.ok(err.code === 'PATH_TRAVERSAL' || err.code === 'OUTSIDE_SANDBOX');
        return true;
      },
    );
  });

  it('blocks absolute paths', () => {
    assert.throws(
      () => resolveSandboxPath('/etc/passwd'),
      (err: unknown) => {
        assert.ok(err instanceof SandboxViolationError);
        assert.equal(err.code, 'ABSOLUTE_PATH');
        return true;
      },
    );
  });

  it('blocks absolute path with /tmp', () => {
    assert.throws(
      () => resolveSandboxPath('/tmp/evil.ts'),
      (err: unknown) => {
        assert.ok(err instanceof SandboxViolationError);
        assert.equal(err.code, 'ABSOLUTE_PATH');
        return true;
      },
    );
  });
});

// ---------------------------------------------------------------------------
// executeSandboxWrite - direct
// ---------------------------------------------------------------------------

describe('executeSandboxWrite - direct', () => {
  it('writes file and returns written outcome with checksums', () => {
    const content = 'export const x = 42;';
    const filePath = `utils/direct-${randomUUID()}.ts`;

    const result = executeSandboxWrite(
      randomUUID(), 'scaffold_file', 'sigma-dev', filePath, content, 'test-user',
    );

    assert.equal(result.outcome, 'written');
    assert.equal(result.checksumPre, sha256(content));
    assert.equal(result.checksumPost, sha256(content));
    assert.equal(result.resolvedBy, 'test-user');
    assert.ok(result.sandboxPath.includes('direct-'));
    assert.ok(result.approvalId);
    assert.ok(result.writtenAt);

    // Verify file exists on disk
    const absPath = join(TEST_SANDBOX, result.sandboxPath);
    assert.ok(existsSync(absPath), 'file must exist on disk');
    assert.equal(readFileSync(absPath, 'utf8'), content);
  });

  it('creates nested directories automatically', () => {
    const content = '# Docs';
    const filePath = `docs/nested/deep/${randomUUID()}.md`;

    const result = executeSandboxWrite(
      randomUUID(), 'write_docs', 'sigma-dev', filePath, content, 'test-user',
    );
    assert.equal(result.outcome, 'written');
    const absPath = join(TEST_SANDBOX, result.sandboxPath);
    assert.ok(existsSync(absPath));
  });

  it('blocks overwrite of existing file without overwriteApproved', () => {
    const content = 'first write';
    const filePath = `utils/overwrite-test-${randomUUID()}.ts`;

    // First write succeeds
    executeSandboxWrite(randomUUID(), 'scaffold_file', 'sigma-dev', filePath, content, 'test-user');

    // Second write blocked
    assert.throws(
      () => executeSandboxWrite(randomUUID(), 'scaffold_file', 'sigma-dev', filePath, 'second write', 'test-user'),
      (err: unknown) => {
        assert.ok(err instanceof SandboxViolationError);
        assert.equal(err.code, 'OVERWRITE_BLOCKED');
        return true;
      },
    );
  });

  it('allows overwrite when overwriteApproved=true', () => {
    const filePath = `utils/overwrite-ok-${randomUUID()}.ts`;

    executeSandboxWrite(randomUUID(), 'scaffold_file', 'sigma-dev', filePath, 'v1', 'user');

    const result = executeSandboxWrite(
      randomUUID(), 'scaffold_file', 'sigma-dev', filePath, 'v2', 'user', true,
    );
    assert.equal(result.outcome, 'written');
    const absPath = join(TEST_SANDBOX, result.sandboxPath);
    assert.equal(readFileSync(absPath, 'utf8'), 'v2');
  });

  it('records write in sandbox audit log', () => {
    const content = 'export const logged = true;';
    const approvalId = randomUUID();
    const filePath = `utils/logged-${randomUUID()}.ts`;

    executeSandboxWrite(approvalId, 'generate_code', 'sigma-dev', filePath, content, 'auditor');

    const log = getSandboxLog();
    const entry = log.find(e => e.approvalId === approvalId);
    assert.ok(entry, 'audit entry must exist');
    assert.equal(entry.outcome, 'written');
    assert.equal(entry.checksumPre, sha256(content));
    assert.equal(entry.checksumPost, sha256(content));
    assert.equal(entry.resolvedBy, 'auditor');
    assert.equal(entry.action, 'generate_code');
  });
});

// ---------------------------------------------------------------------------
// executeWrite via runtime (approval flow)
// ---------------------------------------------------------------------------

describe('executeWrite - runtime approval flow', () => {
  it('approved write succeeds - file lands on disk', async () => {
    const content = 'export const fromApproval = true;';
    const filePath = `runtime/approved-${randomUUID()}.ts`;
    const pending = makeApproval('scaffold_file', filePath, content);

    const resolved = resolveApproval(pending.id, true, 'julio');
    assert.ok(resolved);
    assert.equal(resolved.status, 'approved');

    const result = executeWrite(resolved);
    assert.equal(result.outcome, 'written');
    if (result.outcome === 'written') {
      assert.ok(result.sandboxResult.sandboxPath.includes('runtime'));
      assert.equal(result.sandboxResult.checksumPre, sha256(content));
      assert.equal(result.sandboxResult.checksumPost, sha256(content));
      assert.equal(result.sandboxResult.resolvedBy, 'julio');
      // Verify file exists
      const absPath = join(TEST_SANDBOX, result.sandboxResult.sandboxPath);
      assert.ok(existsSync(absPath));
      assert.equal(readFileSync(absPath, 'utf8'), content);
    }
  });

  it('denied approval - write does not happen', async () => {
    const filePath = `runtime/denied-${randomUUID()}.ts`;
    const pending = makeApproval('scaffold_file', filePath, 'should not be written');

    const resolved = resolveApproval(pending.id, false, 'julio', 'not needed');
    assert.ok(resolved);
    assert.equal(resolved.status, 'denied');

    const result = executeWrite(resolved);
    assert.equal(result.outcome, 'denied');

    // File must NOT exist
    const expectedPath = join(TEST_SANDBOX, filePath);
    assert.ok(!existsSync(expectedPath), 'file must not be written after denial');
  });

  it('immutability enforced - double resolve returns null, executeWrite not called again', () => {
    const filePath = `runtime/immutable-${randomUUID()}.ts`;
    const pending = makeApproval('generate_code', filePath, 'immutable content');

    const resolved = resolveApproval(pending.id, true, 'julio');
    assert.ok(resolved);

    // First write succeeds
    const result1 = executeWrite(resolved);
    assert.equal(result1.outcome, 'written');

    // Second resolve attempt returns null - immutability upheld
    const second = resolveApproval(pending.id, true, 'julio');
    assert.equal(second, null, 'second resolve must be null');
  });

  it('write outside sandbox via approval is blocked', () => {
    // Craft an artifact with a path that would escape sandbox
    const artifact = {
      action: 'scaffold_file',
      filePath: '../../../etc/evil.ts',
      content: 'evil',
      requiresWrite: true,
      description: 'attack',
      generatedAt: new Date().toISOString(),
    };
    const pending = requestApproval('sigma-dev', 'scaffold_file', 'attack test', { artifact, taskId: randomUUID() });
    const resolved = resolveApproval(pending.id, true, 'attacker');
    assert.ok(resolved);

    const result = executeWrite(resolved);
    // Should be blocked or thrown - the runtime catches SandboxViolationError
    assert.equal(result.outcome, 'blocked', 'path traversal must be blocked');
    assert.ok((result as { outcome: 'blocked'; error: string }).error.length > 0);
  });

  it('absolute path in artifact is blocked', () => {
    const artifact = {
      action: 'scaffold_file',
      filePath: '/tmp/absolute-attack.ts',
      content: 'evil',
      requiresWrite: true,
      description: 'absolute attack',
      generatedAt: new Date().toISOString(),
    };
    const pending = requestApproval('sigma-dev', 'scaffold_file', 'absolute test', { artifact, taskId: randomUUID() });
    const resolved = resolveApproval(pending.id, true, 'attacker');
    assert.ok(resolved);

    const result = executeWrite(resolved);
    assert.equal(result.outcome, 'blocked');
  });

  it('checksum pre and post match for successful write', () => {
    const content = 'export const checksum = "test";';
    const filePath = `runtime/checksum-${randomUUID()}.ts`;
    const pending = makeApproval('generate_code', filePath, content);
    const resolved = resolveApproval(pending.id, true, 'julio');
    assert.ok(resolved);

    const result = executeWrite(resolved);
    assert.equal(result.outcome, 'written');
    if (result.outcome === 'written') {
      assert.equal(result.sandboxResult.checksumPre, sha256(content));
      assert.equal(result.sandboxResult.checksumPost, sha256(content));
      assert.equal(result.sandboxResult.checksumPre, result.sandboxResult.checksumPost);
    }
  });
});
