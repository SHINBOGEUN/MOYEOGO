import assert from 'node:assert/strict';
import test from 'node:test';
import {
  deleteRemoteTripPhoto, downloadRemoteTripPhoto, loadRemoteTripSync,
  RemoteTripSyncError, uploadRemoteTripPhoto,
} from '../src/data/remoteTripSync.ts';

const serverSnapshot = {
  groupRevision: 7,
  coverPhotoId: 'cover-photo',
  coverVersion: 3,
  settledAt: null,
  settlementVersion: 2,
  photos: [{
    id: 'cover-photo', storageKey: 'group/trip/cover-photo', mimeType: 'image/jpeg',
    sizeBytes: 12, width: null, height: 20, latitude: null, longitude: 127.1,
    addedAt: '2026-10-24T00:00:00Z', version: 4,
  }],
  expenses: [{
    id: 'expense', title: 'Lunch', amount: 12000, payerId: 'member-1',
    participantIds: ['member-1'], createdByUserId: 'user-1', version: 2,
  }],
};

test('trip sync loader makes one RPC call and maps its coherent snapshot', async () => {
  const calls = [];
  const client = { rpc: async (...args) => { calls.push(args); return { data: serverSnapshot, error: null }; } };

  const snapshot = await loadRemoteTripSync(client, 'group-uuid', 'trip');

  assert.equal(calls.length, 1);
  assert.equal(calls[0][0], 'load_group_trip_sync_snapshot');
  assert.deepEqual(calls[0][1], { requested_group_id: 'group-uuid', requested_trip_id: 'trip' });
  assert.equal(snapshot.groupRevision, 7);
  assert.equal(snapshot.coverVersion, 3);
  assert.equal(snapshot.photos[0].uri, '');
  assert.equal(snapshot.photos[0].version, 4);
  assert.equal(snapshot.expenses[0].amount, 12000);
  assert.equal(snapshot.settledAt, undefined);
});

test('deleting the current cover returns the server cover revision for the next cover command', async () => {
  const calls = [];
  const client = {
    rpc: async (name, args) => {
      calls.push([name, args]);
      if (name === 'load_group_trip_sync_snapshot') return { data: serverSnapshot, error: null };
      return { data: {
        eventId: 'event', groupId: 'group-uuid', tripId: 'trip', groupRevision: 8,
        entity: { coverPhotoId: null }, entityVersion: 5, coverVersion: 4, deleted: true,
      }, error: null };
    },
    storage: { from: () => ({ remove: async () => ({ error: null }) }) },
  };

  const result = await deleteRemoteTripPhoto(client, 'group-uuid', 'trip', 'cover-photo', 4, 'retry-key');

  assert.equal(calls[0][0], 'load_group_trip_sync_snapshot');
  assert.equal(calls[1][0], 'apply_group_trip_sync_change');
  assert.equal(calls[1][1].requested_action, 'photo.delete');
  assert.equal(result.entity.coverPhotoId, null);
  assert.equal(result.coverVersion, 4);
  assert.equal(result.storageObjectDeleted, true);
});

test('photo upload errors identify Storage upload stage and never expose provider details', async () => {
  const secretMessage = 'https://storage.example/private/group/trip/photo?token=super-secret';
  const client = { storage: { from: () => ({ upload: async () => ({ error: { message: secretMessage } }) }) } };
  const photo = {
    id: 'photo', storageKey: 'group/trip/photo', mimeType: 'image/jpeg', sizeBytes: 1,
    width: 1, height: 1, addedAt: '2026-10-24T00:00:00Z', bytes: new Uint8Array([1]),
  };

  await assert.rejects(uploadRemoteTripPhoto(client, 'group', 'trip', photo), (error) => {
    assert.ok(error instanceof RemoteTripSyncError);
    assert.equal(error.stage, 'photo_storage_upload');
    assert.equal(error.code, 'photo_storage_upload_failed');
    assert.equal(error.message.includes(secretMessage), false);
    assert.equal(error.message.includes('super-secret'), false);
    return true;
  });
});

test('metadata RPC errors identify upsert stage and return a safe message', async () => {
  const secretMessage = 'photo_object_not_found /private/path with bearer-token';
  const client = {
    storage: { from: () => ({ upload: async () => ({ error: null }) }) },
    rpc: async () => ({ data: null, error: { message: secretMessage } }),
  };
  const photo = {
    id: 'photo', storageKey: 'group/trip/photo', mimeType: 'image/jpeg', sizeBytes: 1,
    width: 1, height: 1, addedAt: '2026-10-24T00:00:00Z', bytes: new Uint8Array([1]),
  };

  await assert.rejects(uploadRemoteTripPhoto(client, 'group', 'trip', photo), (error) => {
    assert.equal(error.stage, 'photo_upsert');
    assert.equal(error.code, 'photo_object_not_found');
    assert.equal(error.message.includes(secretMessage), false);
    assert.equal(error.message.includes('bearer-token'), false);
    return true;
  });
});

test('cover and download failures expose distinct safe stages', async () => {
  const client = {
    rpc: async () => ({ data: null, error: { message: 'internal error /secret/path' } }),
    storage: { from: () => ({ download: async () => ({ data: null, error: { message: 'signed url?token=secret' } }) }) },
  };
  const photo = {
    id: 'photo', storageKey: 'group/trip/photo', mimeType: 'image/jpeg', sizeBytes: 1,
    width: 1, height: 1, latitude: undefined, longitude: undefined, addedAt: '2026-10-24T00:00:00Z', version: 1,
  };
  await assert.rejects(import('../src/data/remoteTripSync.ts').then(({ setRemoteTripCover }) =>
    setRemoteTripCover(client, 'group', 'trip', photo, 0)), (error) => error.stage === 'photo_set_cover' && !error.message.includes('/secret/path'));
  await assert.rejects(downloadRemoteTripPhoto(client, 'group/trip/photo'), (error) =>
    error.stage === 'photo_download' && error.code === 'photo_download_failed' && !error.message.includes('secret'));
});

test('photo tombstone and Storage cleanup failures remain separately observable', async () => {
  const client = {
    rpc: async (name) => name === 'load_group_trip_sync_snapshot'
      ? { data: serverSnapshot, error: null }
      : { data: null, error: { message: 'photo_delete_forbidden /private/path' } },
    storage: { from: () => ({ remove: async () => ({ error: null }) }) },
  };
  await assert.rejects(deleteRemoteTripPhoto(client, 'group', 'trip', 'cover-photo', 4), (error) =>
    error.stage === 'photo_remote_delete' && error.code === 'photo_delete_forbidden' && !error.message.includes('/private/path'));

  const cleanupClient = {
    rpc: async (name) => name === 'load_group_trip_sync_snapshot'
      ? { data: serverSnapshot, error: null }
      : { data: { eventId: 'event', groupId: 'group-uuid', tripId: 'trip', groupRevision: 8, entity: { coverPhotoId: null }, entityVersion: 5, deleted: true }, error: null },
    storage: { from: () => ({ remove: async () => ({ error: { message: 'object key /private/path access-token' } }) }) },
  };
  const result = await deleteRemoteTripPhoto(cleanupClient, 'group', 'trip', 'cover-photo', 4);
  assert.equal(result.storageObjectDeleted, false);
  assert.equal(result.storageCleanupError.stage, 'photo_storage_cleanup');
  assert.equal(result.storageCleanupError.code, 'photo_storage_cleanup_failed');
  assert.equal(result.storageCleanupError.message.includes('/private/path'), false);
  assert.equal(result.storageCleanupError.message.includes('access-token'), false);
});
