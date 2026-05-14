// tests/memory.test.ts
// Slice 2b: memory rewrite tests
// memSet, memGet, memDel, memList, memClear

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import { memSet, memGet, memDel, memList, memClear } from '../core/memory/index.js';

const NS = 'test-memory';

describe('Memory store', () => {

  // Wipe the test namespace before each test to keep them isolated
  beforeEach(() => { memClear(NS); });

  // -------------------------------------------------------------------------
  // memSet / memGet
  // -------------------------------------------------------------------------
  describe('memSet and memGet', () => {
    it('stores and retrieves a string value', () => {
      memSet(NS, 'greeting', 'hello', 'test');
      const entry = memGet(NS, 'greeting');
      assert.ok(entry);
      assert.equal(entry.value, 'hello');
      assert.equal(entry.key, 'greeting');
      assert.equal(entry.namespace, NS);
      assert.equal(entry.writtenBy, 'test');
      assert.ok(entry.writtenAt);
    });

    it('stores and retrieves a number value', () => {
      memSet(NS, 'count', 42, 'test');
      const entry = memGet(NS, 'count');
      assert.ok(entry);
      assert.equal(entry.value, 42);
    });

    it('stores and retrieves an object value', () => {
      const obj = { symbol: 'ES', qty: 5 };
      memSet(NS, 'trade', obj, 'sigma-bot');
      const entry = memGet(NS, 'trade');
      assert.ok(entry);
      assert.deepEqual(entry.value, obj);
    });

    it('upserts on second write - overwrites value', () => {
      memSet(NS, 'key', 'first', 'test');
      memSet(NS, 'key', 'second', 'test');
      const entry = memGet(NS, 'key');
      assert.ok(entry);
      assert.equal(entry.value, 'second');
    });

    it('returns null for missing key', () => {
      const entry = memGet(NS, 'does-not-exist');
      assert.equal(entry, null);
    });

    it('namespaces are isolated', () => {
      memSet('ns-a', 'x', 1, 'test');
      memSet('ns-b', 'x', 2, 'test');
      assert.equal(memGet('ns-a', 'x')?.value, 1);
      assert.equal(memGet('ns-b', 'x')?.value, 2);
      // cleanup
      memClear('ns-a');
      memClear('ns-b');
    });
  });

  // -------------------------------------------------------------------------
  // memDel
  // -------------------------------------------------------------------------
  describe('memDel', () => {
    it('deletes an existing key', () => {
      memSet(NS, 'to-delete', 'bye', 'test');
      memDel(NS, 'to-delete');
      assert.equal(memGet(NS, 'to-delete'), null);
    });

    it('is a no-op for a missing key', () => {
      assert.doesNotThrow(() => memDel(NS, 'never-existed'));
    });

    it('does not delete other keys in the same namespace', () => {
      memSet(NS, 'keep', 'yes', 'test');
      memSet(NS, 'remove', 'no', 'test');
      memDel(NS, 'remove');
      assert.ok(memGet(NS, 'keep'));
      assert.equal(memGet(NS, 'remove'), null);
    });
  });

  // -------------------------------------------------------------------------
  // memList
  // -------------------------------------------------------------------------
  describe('memList', () => {
    it('returns all entries in a namespace ordered by key', () => {
      memSet(NS, 'b', 2, 'test');
      memSet(NS, 'a', 1, 'test');
      memSet(NS, 'c', 3, 'test');
      const list = memList(NS);
      assert.equal(list.length, 3);
      assert.equal(list[0].key, 'a');
      assert.equal(list[1].key, 'b');
      assert.equal(list[2].key, 'c');
    });

    it('returns empty array for empty namespace', () => {
      const list = memList(NS);
      assert.deepEqual(list, []);
    });

    it('does not include keys from other namespaces', () => {
      memSet('other-ns', 'leak', 'bad', 'test');
      memSet(NS, 'ok', 'good', 'test');
      const list = memList(NS);
      assert.equal(list.length, 1);
      assert.equal(list[0].key, 'ok');
      memClear('other-ns');
    });
  });

  // -------------------------------------------------------------------------
  // memClear
  // -------------------------------------------------------------------------
  describe('memClear', () => {
    it('removes all keys in the namespace', () => {
      memSet(NS, 'a', 1, 'test');
      memSet(NS, 'b', 2, 'test');
      memClear(NS);
      assert.deepEqual(memList(NS), []);
    });

    it('does not affect other namespaces', () => {
      memSet('safe-ns', 'key', 'value', 'test');
      memSet(NS, 'gone', 'yes', 'test');
      memClear(NS);
      assert.ok(memGet('safe-ns', 'key'));
      memClear('safe-ns');
    });

    it('is a no-op on an empty namespace', () => {
      assert.doesNotThrow(() => memClear(NS));
    });
  });

});
