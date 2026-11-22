import type { RemoteTripSyncStage } from '../data/remoteTripSync';

const stages = [
  'sync', 'photo_storage_upload', 'photo_upsert', 'photo_set_cover',
  'photo_download', 'photo_remote_delete', 'photo_storage_cleanup',
] as const satisfies readonly RemoteTripSyncStage[];

const stageLabels: Record<RemoteTripSyncStage, string> = {
  sync: '여행 정보 동기화',
  photo_storage_upload: '사진 업로드',
  photo_upsert: '사진 정보 등록',
  photo_set_cover: '대표 사진 설정',
  photo_download: '공유 사진 다운로드',
  photo_remote_delete: '공유 사진 삭제',
  photo_storage_cleanup: '서버 파일 정리',
};

const stableCodes = new Set([
  'authentication_required', 'trip_not_found_or_forbidden', 'invalid_sync_command',
  'idempotency_key_reused', 'sync_version_conflict', 'expense_change_forbidden',
  'expense_delete_forbidden', 'invalid_expense_payload', 'invalid_expense_member',
  'trip_settled', 'settlement_already_complete', 'settlement_not_complete',
  'invalid_settlement_entity_id', 'invalid_photo_metadata', 'photo_object_not_found',
  'photo_change_forbidden', 'photo_delete_forbidden', 'cover_photo_not_registered',
  'cover_photo_must_change_first', 'photo_storage_upload_failed', 'photo_upsert_failed',
  'photo_set_cover_failed', 'photo_download_failed', 'photo_remote_delete_failed',
  'photo_storage_cleanup_failed', 'remote_trip_sync_failed', 'invalid_sync_response',
  'invalid_sync_snapshot', 'invalid_photo_size',
  'invalid_download_size',
]);

export function tripSyncFailureMessage(
  error: unknown,
  lead: string,
  photoProgress?: { succeeded: number; total: number },
): string {
  const candidate = error && typeof error === 'object' ? error as { name?: unknown; stage?: unknown; code?: unknown } : undefined;
  const remoteError = candidate?.name === 'RemoteTripSyncError' ? candidate : undefined;
  const safeStage = stages.find((stage) => stage === remoteError?.stage) ?? 'sync';
  const stage = stageLabels[safeStage];
  const code = typeof remoteError?.code === 'string' && stableCodes.has(remoteError.code)
    ? remoteError.code : 'remote_trip_sync_failed';
  const progress = photoProgress && photoProgress.total > 1
    ? ` 현재 ${photoProgress.succeeded}/${photoProgress.total}장까지 공유됐어요.`
    : '';
  return `${lead} ${stage} 단계에서 실패했어요.${progress} 코드: ${code}`;
}
