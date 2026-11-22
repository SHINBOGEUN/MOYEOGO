import assert from 'node:assert/strict';
import { mergeRemoteTripSyncSnapshot, preserveTripSyncEntities } from '../src/domain/tripSyncMapping.ts';
import { preserveLocalGroupPhotoUris } from '../src/data/localGroupPhotos.ts';

const baseTrip = {
  id: 'trip-1', name: 'Trip', destination: '', detailAddress: '', dateRange: '', treasurerId: 'm1',
  expenses: [
    { id: 'shared-expense', title: 'old', amount: 100, payerId: 'm1', participantIds: ['m1'], version: 1 },
    { id: 'local-expense', title: 'local', amount: 50, payerId: 'm2', participantIds: ['m2'] },
  ],
  photos: [
    { id: 'shared-photo', uri: 'file:///cache/shared.jpg', addedAt: '2026-10-01', version: 1, storageKey: 'group/trip/photo' },
    { id: 'local-photo', uri: 'file:///document/local.jpg', addedAt: '2026-10-02' },
  ],
  coverPhotoId: 'shared-photo', settledAt: '2026-10-03',
};

const snapshot = {
  groupRevision: 8, coverPhotoId: undefined, coverVersion: 2,
  settledAt: undefined, settlementVersion: 3,
  photos: [],
  expenses: [{ id: 'shared-expense', title: 'new', amount: 200, payerId: 'm2', participantIds: ['m2'], version: 2 }],
};

const merged = mergeRemoteTripSyncSnapshot(baseTrip, snapshot);
assert.deepEqual(merged.expenses.map(({ id }) => id), ['shared-expense', 'local-expense']);
assert.equal(merged.expenses[0].title, 'new');
assert.equal(merged.photos.length, 1);
assert.equal(merged.photos[0].id, 'local-photo');
assert.equal(merged.coverPhotoId, undefined);
assert.equal(merged.settledAt, undefined);
assert.equal(merged.syncRevision, 8);

const staleGroup = [{ id: 'g', name: 'G', members: [], trips: [{ ...baseTrip,
  expenses: [{ id: 'shared-expense', title: 'stale', amount: 1, payerId: 'm1', participantIds: ['m1'] }],
  photos: [], coverPhotoId: 'stale',
}] }];
const localGroup = [{ id: 'g', name: 'G', members: [], trips: [{ ...merged,
  photos: [{ ...merged.photos[0], uri: 'file:///document/local.jpg' }],
}] }];
const withUris = preserveLocalGroupPhotoUris(staleGroup, localGroup);
const restored = preserveTripSyncEntities(withUris, localGroup)[0].trips[0];
assert.equal(restored.expenses[0].title, 'new');
assert.equal(restored.photos[0].uri, 'file:///document/local.jpg');
assert.equal(restored.coverPhotoId, undefined);
