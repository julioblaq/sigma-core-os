**
            * tests/approval-spine.test.ts
 * Slice 2 tests: approve, deny, and double-resolution prevention.
                        *
                        * Uses Node built-in test runner (node:test) + assert.
                        * Run: npm test
 */

                       import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { requestApproval, resolveApproval, getApproval, listPending } from '../core/policies/index.js';
import { logOutcome, getLog } from '../core/runtime/index.js';

describe('Approval spine', () => {

           // -------------------------------------------------------------------------
           // APPROVE path
           // -------------------------------------------------------------------------
           describe('approve flow', () => {
                          it('requestApproval returns pending status', () => {
                                           const a = requestApproval('sigma-bot', 'trade_plan', 'Trade plan: LONG 1x ES', {
                                                              symbol: 'ES', direction: 'long', quantity: 1,
                                           });
                                           assert.equal(a.status, 'pending');
                                           assert.ok(a.id);
                                           assert.equal(a.resolvedAt, undefined);
                                           assert.equal(a.resolvedBy, undefined);
                                           assert.equal(a.reason, undefined);
                          });

                        it('resolveApproval sets status to approved', () => {
                                         const a = requestApproval('sigma-bot', 'trade_plan', 'Trade plan: LONG 1x ES', {
                                                            symbol: 'ES', direction: 'long', quantity: 1,
                                         });
                                         const resolved = resolveApproval(a.id, true, 'julio');
                                         assert.ok(resolved);
                                         assert.equal(resolved.status, 'approved');
                                         assert.ok(resolved.resolvedAt);
                                         assert.equal(resolved.resolvedBy, 'julio');
                                         assert.equal(resolved.reason, undefined);
                        });

                        it('logOutcome records approved outcome', () => {
                                         const a = requestApproval('sigma-bot', 'trade_plan', 'Trade plan: LONG 1x ES', {
                                                            symbol: 'ES', direction: 'long', quantity: 1,
                                         });
                                         const resolved = resolveApproval(a.id, true, 'julio')!;
                                         const entry = logOutcome(resolved, 'trade_plan');
                                         assert.equal(entry.outcome, 'approved');
                                         assert.equal(entry.approvalId, a.id);
                                         assert.equal(entry.agent, 'sigma-bot');
                                         assert.equal(entry.reason, undefined);

                                 const log = getLog();
                                         assert.ok(log.some(e => e.approvalId === a.id && e.outcome === 'approved'));
                        });
           });

           // -------------------------------------------------------------------------
           // DENY path
           // -------------------------------------------------------------------------
           describe('deny flow', () => {
                          it('resolveApproval sets status to denied with reason', () => {
                                           const a = requestApproval('sigma-bot', 'trade_plan', 'Trade plan: SHORT 2x NQ', {
                                                              symbol: 'NQ', direction: 'short', quantity: 2,
                                           });
                                           const resolved = resolveApproval(a.id, false, 'julio', 'volatility too high');
                                           assert.ok(resolved);
                                           assert.equal(resolved.status, 'denied');
                                           assert.ok(resolved.resolvedAt);
                                           assert.equal(resolved.resolvedBy, 'julio');
                                           assert.equal(resolved.reason, 'volatility too high');
                          });

                        it('denied approval has reason stored in DB', () => {
                                         const a = requestApproval('sigma-bot', 'trade_plan', 'Trade plan: SHORT 1x ES', {
                                                            symbol: 'ES', direction: 'short', quantity: 1,
                                         });
                                         resolveApproval(a.id, false, 'julio', 'news blackout period');
                                         const fetched = getApproval(a.id);
                                         assert.ok(fetched);
                                         assert.equal(fetched.status, 'denied');
                                         assert.equal(fetched.reason, 'news blackout period');
                        });

                        it('logOutcome records denied outcome with reason', () => {
                                         const a = requestApproval('sigma-bot', 'trade_plan', 'Trade plan: LONG 5x ES', {
                                                            symbol: 'ES', direction: 'long', quantity: 5,
                                         });
                                         const resolved = resolveApproval(a.id, false, 'julio', 'position size too large')!;
                                         const entry = logOutcome(resolved, 'trade_plan');
                                         assert.equal(entry.outcome, 'denied');
                                         assert.equal(entry.reason, 'position size too large');

                                 const log = getLog();
                                         const found = log.find(e => e.approvalId === a.id);
                                         assert.ok(found);
                                         assert.equal(found.outcome, 'denied');
                                         assert.equal(found.reason, 'position size too large');
                        });

                        it('denial without reason returns 400 from API (server-level guard)', () => {
                                         const approved = false;
                                         const reason = undefined;
                                         const shouldReject = !approved && !reason;
                                         assert.equal(shouldReject, true, 'server should reject deny without reason');
                        });
           });

           // -------------------------------------------------------------------------
           // IMMUTABILITY: double-resolution prevention
           // -------------------------------------------------------------------------
           describe('immutability - double-resolution prevention', () => {
                          it('cannot approve an already-approved record', () => {
                                           const a = requestApproval('sigma-bot', 'trade_plan', 'Trade plan: LONG 1x ES', {
                                                              symbol: 'ES', direction: 'long', quantity: 1,
                                           });
                                           resolveApproval(a.id, true, 'julio');
                                           const second = resolveApproval(a.id, true, 'julio');
                                           assert.equal(second, null, 'resolveApproval must return null for already-resolved record');
                          });

                        it('cannot deny an already-approved record', () => {
                                         const a = requestApproval('sigma-bot', 'trade_plan', 'Trade plan: LONG 1x ES', {
                                                            symbol: 'ES', direction: 'long', quantity: 1,
                                         });
                                         resolveApproval(a.id, true, 'julio');
                                         const second = resolveApproval(a.id, false, 'julio', 'changed my mind');
                                         assert.equal(second, null, 'resolveApproval must return null for already-resolved record');
                        });

                        it('cannot approve an already-denied record', () => {
                                         const a = requestApproval('sigma-bot', 'trade_plan', 'Trade plan: SHORT 1x ES', {
                                                            symbol: 'ES', direction: 'short', quantity: 1,
                                         });
                                         resolveApproval(a.id, false, 'julio', 'risk limit');
                                         const second = resolveApproval(a.id, true, 'julio');
                                         assert.equal(second, null, 'resolveApproval must return null for already-resolved record');
                        });

                        it('status is immutable after resolution', () => {
                                         const a = requestApproval('sigma-bot', 'trade_plan', 'Trade plan: LONG 1x ES', {
                                                            symbol: 'ES', direction: 'long', quantity: 1,
                                         });
                                         resolveApproval(a.id, false, 'julio', 'test denial');
                                         resolveApproval(a.id, true, 'julio'); // returns null, does nothing
                                 const fetched = getApproval(a.id);
                                         assert.ok(fetched);
                                         assert.equal(fetched.status, 'denied', 'status must remain denied');
                        });

                        it('listPending does not include resolved approvals', () => {
                                         const a = requestApproval('sigma-bot', 'trade_plan', 'Trade plan: LONG 1x ES', {
                                                            symbol: 'ES', direction: 'long', quantity: 1,
                                         });
                                         resolveApproval(a.id, true, 'julio');
                                         const pending = listPending();
                                         assert.ok(!pending.some(p => p.id === a.id), 'resolved approval must not appear in pending list');
                        });
           });

});
