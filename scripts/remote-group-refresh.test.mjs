import test from 'node:test';
import assert from 'node:assert/strict';
import {
  isMemberActiveForDisplay,
  isRemoteMemberActive,
  mergeRemoteGroupSnapshot,
  RemoteGroupRefreshGeneration,
} from '../src/domain/remoteGroupRefresh.ts';

const group = (id) => ({ id, name: id, members: [], trips: [] });

test('only the latest remote group refresh for the active account remains current', () => {
  const refreshes = new RemoteGroupRefreshGeneration();
  refreshes.setActiveUser('account-a');
  const first = refreshes.begin('account-a');
  const latest = refreshes.begin('account-a');

  assert.equal(refreshes.isCurrent('account-a', first), false);
  assert.equal(refreshes.isCurrent('account-a', latest), true);
});

test('account changes invalidate prior refreshes, including when switching back', () => {
  const refreshes = new RemoteGroupRefreshGeneration();
  refreshes.setActiveUser('account-a');
  const prior = refreshes.begin('account-a');
  refreshes.setActiveUser('account-b');
  assert.equal(refreshes.begin('account-a'), null);
  refreshes.setActiveUser('account-a');

  assert.equal(refreshes.isCurrent('account-a', prior), false);
});

test('a remote snapshot drops previously remote groups absent from the snapshot and keeps local-only groups', () => {
  const merged = mergeRemoteGroupSnapshot(
    [group('remote-current')],
    [group('remote-current'), group('remote-removed'), group('local-only')],
    new Set(['remote-current', 'remote-removed']),
  );

  assert.deepEqual(merged.map(({ id }) => id), ['remote-current', 'local-only']);
});

test('missing member status is never treated as active', () => {
  assert.equal(isRemoteMemberActive('member-1', undefined), false);
  assert.equal(isRemoteMemberActive(undefined, 'active'), false);
  assert.equal(isRemoteMemberActive('member-1', 'pending'), false);
  assert.equal(isRemoteMemberActive('member-1', 'active'), true);
});

test('remote member display requires explicit active status while local members stay active', () => {
  assert.equal(isMemberActiveForDisplay('member-1', undefined, true), false);
  assert.equal(isMemberActiveForDisplay('member-1', 'pending', true), false);
  assert.equal(isMemberActiveForDisplay('member-1', 'removed', true), false);
  assert.equal(isMemberActiveForDisplay('member-1', 'active', true), true);
  assert.equal(isMemberActiveForDisplay('member-1', undefined, false), true);
});
