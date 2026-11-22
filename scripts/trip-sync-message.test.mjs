import test from 'node:test';
import assert from 'node:assert/strict';
import { RemoteTripSyncError } from '../src/data/remoteTripSync.ts';
import { tripSyncFailureMessage } from '../src/domain/tripSyncMessage.ts';

test('formats only a human stage and stable code from remote sync errors', () => {
  const error = new RemoteTripSyncError(
    'photo_storage_upload_failed',
    'https://private.example/storage/path?token=secret service key=private',
    'photo_storage_upload',
  );
  const message = tripSyncFailureMessage(error, '이 기기에는 저장했지만 모임에 공유하지 못했어요.');
  assert.match(message, /사진 업로드 단계/);
  assert.match(message, /photo_storage_upload_failed/);
  assert.doesNotMatch(message, /https?:|private\.example|storage\/path|token=|secret|key=private/);
});

test('reports partial success count without exposing a raw error', () => {
  const error = new RemoteTripSyncError(
    'photo_upsert_failed',
    'sensitive server detail /object/private',
    'photo_upsert',
  );
  const message = tripSyncFailureMessage(error, '공유하지 못했어요.', { succeeded: 2, total: 5 });
  assert.match(message, /사진 정보 등록 단계/);
  assert.match(message, /2\/5장까지 공유됐어요/);
  assert.match(message, /photo_upsert_failed/);
  assert.doesNotMatch(message, /sensitive|object\/private/);
});

test('falls back to a stable generic code for unknown errors and codes', () => {
  const message = tripSyncFailureMessage(
    new RemoteTripSyncError('https://host/private?auth=secret', 'raw URL and auth', 'photo_download'),
    '다시 동기화하지 못했어요.',
  );
  assert.match(message, /공유 사진 다운로드 단계/);
  assert.match(message, /remote_trip_sync_failed/);
  assert.doesNotMatch(message, /https?:|host\/private|auth=secret|raw URL/);
});
