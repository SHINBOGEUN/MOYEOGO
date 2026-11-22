import assert from 'node:assert/strict';
import test from 'node:test';
import {
  reconcileExpenseFromRemoteSnapshot,
  reconcileSettlementFromRemoteSnapshot,
  rollbackExpenseOperation,
  rollbackSettlementOperation,
  tripSyncCommandStatusFromError,
} from '../src/domain/tripSyncRecovery.ts';
import { RemoteTripSyncError } from '../src/data/remoteTripSync.ts';
import { TripSyncStatusGeneration } from '../src/domain/tripSyncStatusGeneration.ts';

const baseTrip = {
  id: 'trip', name: 'trip', destination: '', detailAddress: '', dateRange: '', treasurerId: 'a',
  expenses: [
    { id: 'target', title: 'old', amount: 100, payerId: 'a', participantIds: ['a'], version: 1 },
    { id: 'other', title: 'keep', amount: 20, payerId: 'b', participantIds: ['b'], version: 2 },
  ],
  settledAt: 'old-settlement', syncRevision: 10, coverPhotoId: 'cover',
};

const snapshot = (expenses, settledAt = 'canonical-settlement', groupRevision = 11) => ({
  groupRevision, coverPhotoId: 'canonical-cover', coverVersion: 3, settledAt, settlementVersion: 4,
  photos: [], expenses,
});

test('older command completion cannot replace the latest trip status after overlapping expenses', () => {
  const generations = new TripSyncStatusGeneration();
  const tripKey = 'group:trip';
  const olderExpenseCommand = generations.begin(tripKey);
  const newerExpenseCommand = generations.begin(tripKey);
  const visibleStatus = { commandId: 'newer', outcome: 'applied' };

  if (generations.isCurrent(tripKey, newerExpenseCommand)) {
    visibleStatus.commandId = 'newer';
    visibleStatus.outcome = 'applied';
  }
  if (generations.isCurrent(tripKey, olderExpenseCommand)) {
    visibleStatus.commandId = 'older';
    visibleStatus.outcome = 'unknown';
  }

  assert.deepEqual(visibleStatus, { commandId: 'newer', outcome: 'applied' });
  assert.notEqual(generations.begin('group:other-trip'), newerExpenseCommand);
});

test('failed local persistence is not reported as saved and disables command resend', () => {
  const error = new RemoteTripSyncError('remote_trip_sync_failed', 'request failed', 'sync', {
    commandId: 'expense-command', safeToResend: true,
  });
  const status = tripSyncCommandStatusFromError(error, false);
  assert.equal(status.localSaved, false);
  assert.equal(status.failureStage, 'local_save');
  assert.equal(status.commandId, 'expense-command');
  assert.equal(status.safeToResend, false);
});

test('remote command resend remains gated on confirmed local save and its command ID', () => {
  const error = new RemoteTripSyncError('remote_trip_sync_failed', 'request failed', 'sync', {
    commandId: 'expense-command', safeToResend: true,
  });
  const status = tripSyncCommandStatusFromError(error, true);
  assert.equal(status.localSaved, true);
  assert.equal(status.safeToResend, true);
  assert.equal(status.commandId, 'expense-command');
  assert.equal(tripSyncCommandStatusFromError({ ...error, commandId: undefined }, true).safeToResend, false);
});

test('expense create failure refetch removes only the uncommitted expense', () => {
  const optimistic = { id: 'target', title: 'new', amount: 100, payerId: 'a', participantIds: ['a'] };
  const result = reconcileExpenseFromRemoteSnapshot({ ...baseTrip, expenses: [optimistic, baseTrip.expenses[1]] }, snapshot([baseTrip.expenses[1]]), 'target');
  assert.deepEqual(result.expenses, [baseTrip.expenses[1]]);
  assert.equal(result.coverPhotoId, 'cover');
});

test('expense update failure refetch restores the authoritative version and preserves other local expense edits', () => {
  const optimistic = { id: 'target', title: 'optimistic', amount: 300, payerId: 'a', participantIds: ['a'] };
  const concurrentlyEdited = { ...baseTrip.expenses[1], title: 'local concurrent edit' };
  const canonical = { id: 'target', title: 'old', amount: 100, payerId: 'a', participantIds: ['a'], version: 1 };
  const result = reconcileExpenseFromRemoteSnapshot({ ...baseTrip, expenses: [optimistic, concurrentlyEdited] }, snapshot([canonical]), 'target');
  assert.deepEqual(result.expenses, [canonical, concurrentlyEdited]);
});

test('expense delete failure refetch restores the server expense by ID', () => {
  const result = reconcileExpenseFromRemoteSnapshot({ ...baseTrip, expenses: [baseTrip.expenses[1]] }, snapshot(baseTrip.expenses), 'target');
  assert.deepEqual(result.expenses, baseTrip.expenses);
});

test('expense create/update/delete fallback changes only the failed entity and respects a newer local operation', () => {
  const optimistic = { id: 'target', title: 'pending', amount: 300, payerId: 'a', participantIds: ['a'] };
  const rolledBack = rollbackExpenseOperation({ ...baseTrip, expenses: [optimistic, baseTrip.expenses[1]] }, 'target', baseTrip.expenses[0], optimistic);
  assert.deepEqual(rolledBack.expenses, baseTrip.expenses);
  const newer = { ...optimistic, title: 'newer operation' };
  const untouched = rollbackExpenseOperation({ ...baseTrip, expenses: [newer, baseTrip.expenses[1]] }, 'target', baseTrip.expenses[0], optimistic);
  assert.equal(untouched.expenses[0], newer);
  const deleted = rollbackExpenseOperation({ ...baseTrip, expenses: [baseTrip.expenses[1]] }, 'target', baseTrip.expenses[0], undefined);
  assert.deepEqual(deleted.expenses, baseTrip.expenses);
});

test('settlement complete failure refetch applies only authoritative settlement state', () => {
  const optimistic = { ...baseTrip, settledAt: 'optimistic-completion' };
  const result = reconcileSettlementFromRemoteSnapshot(optimistic, snapshot(baseTrip.expenses, 'server-completion'));
  assert.equal(result.settledAt, 'server-completion');
  assert.deepEqual(result.expenses, optimistic.expenses);
  assert.equal(result.coverPhotoId, 'cover');
});

test('settlement reopen failure refetch restores authoritative completed state', () => {
  const optimistic = { ...baseTrip, settledAt: undefined };
  const result = reconcileSettlementFromRemoteSnapshot(optimistic, snapshot(baseTrip.expenses, 'server-completion'));
  assert.equal(result.settledAt, 'server-completion');
  assert.deepEqual(result.expenses, optimistic.expenses);
});

test('settlement complete/reopen fallback restores only while the failed operation owns current state', () => {
  assert.equal(rollbackSettlementOperation({ ...baseTrip, settledAt: 'optimistic' }, 'old-settlement', 'optimistic').settledAt, 'old-settlement');
  assert.equal(rollbackSettlementOperation({ ...baseTrip, settledAt: 'newer' }, 'old-settlement', 'optimistic').settledAt, 'newer');
  assert.equal(rollbackSettlementOperation({ ...baseTrip, settledAt: undefined }, 'old-settlement', undefined).settledAt, 'old-settlement');
});
