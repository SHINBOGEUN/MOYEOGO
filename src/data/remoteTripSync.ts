import type { SupabaseClient } from '@supabase/supabase-js';
import type { Expense } from '../domain/settlement';
import type { TripPhoto } from '../domain/models';

const PHOTO_BUCKET = 'moyeogo-trip-photos';
const MAX_PHOTO_BYTES = 20 * 1024 * 1024;

export type SyncAction =
  | 'photo.upsert' | 'photo.set_cover' | 'photo.delete'
  | 'expense.create' | 'expense.update' | 'expense.delete'
  | 'settlement.complete' | 'settlement.reopen';

export type RemoteTripSyncStage =
  | 'sync' | 'photo_storage_upload' | 'photo_upsert' | 'photo_set_cover'
  | 'photo_download' | 'photo_remote_delete' | 'photo_storage_cleanup';

export type SyncCommandResult<T> = {
  commandId: string;
  eventId: string;
  groupId: string;
  tripId: string;
  groupRevision: number;
  entity: T | null;
  entityVersion: number;
  deleted: boolean;
  /** Current cover state revision returned by photo commands. */
  coverVersion?: number;
};

export type RemotePhoto = Omit<TripPhoto, 'uri'> & {
  storageKey: string;
  mimeType: string;
  sizeBytes: number;
  width?: number;
  height?: number;
  version: number;
};
export type RemoteExpense = Expense & { version: number };
export type RemoteSettlement = { tripId: string; settledAt: string | null; version: number };
export type RemoteTripSyncSnapshot = {
  groupRevision: number;
  coverPhotoId?: string;
  coverVersion: number;
  settledAt?: string;
  settlementVersion: number;
  photos: RemotePhoto[];
  expenses: RemoteExpense[];
};
export type RemoteSyncEvent = {
  id: string;
  group_id: string;
  trip_client_id: string;
  entity_type: 'photo' | 'expense' | 'settlement';
  entity_client_id: string;
  action: string;
  entity_version: number;
  group_revision: number;
};
export type RemotePhotoInput = Omit<RemotePhoto, 'version' | 'uri'>;

export class RemoteTripSyncError extends Error {
  public readonly code: string;
  public readonly stage: RemoteTripSyncStage;
  /** Present when a command RPC was attempted; callers must reuse the identical request and key. */
  public readonly commandId?: string;
  /** True only for expense/settlement RPCs protected by the persisted idempotency table. */
  public readonly safeToResend: boolean;
  public readonly remoteState: 'rejected' | 'unknown';

  constructor(
    code: string,
    message: string,
    stage: RemoteTripSyncStage = 'sync',
    retry?: { commandId: string; safeToResend: boolean; remoteState?: 'rejected' | 'unknown' },
  ) {
    super(message);
    this.code = code;
    this.stage = stage;
    this.commandId = retry?.commandId;
    this.safeToResend = retry?.safeToResend ?? false;
    this.remoteState = retry?.remoteState ?? 'unknown';
    this.name = 'RemoteTripSyncError';
  }
}

function normalizeError(error: unknown, stage: RemoteTripSyncStage = 'sync'): RemoteTripSyncError {
  const rawMessage = error && typeof error === 'object' && 'message' in error && typeof error.message === 'string'
    ? error.message : '';
  const known = [
    'authentication_required', 'trip_not_found_or_forbidden', 'invalid_sync_command',
    'idempotency_key_reused', 'sync_version_conflict', 'expense_change_forbidden',
    'expense_delete_forbidden', 'invalid_expense_payload', 'invalid_expense_member',
    'trip_settled', 'settlement_already_complete', 'settlement_not_complete',
    'invalid_settlement_entity_id', 'invalid_photo_metadata', 'photo_object_not_found',
    'photo_change_forbidden', 'photo_delete_forbidden', 'cover_photo_not_registered',
    'cover_photo_must_change_first',
  ];
  const serverCode = known.find((candidate) => rawMessage.includes(candidate));
  const code = serverCode ?? ({
    photo_storage_upload: 'photo_storage_upload_failed', photo_upsert: 'photo_upsert_failed',
    photo_set_cover: 'photo_set_cover_failed', photo_download: 'photo_download_failed',
    photo_remote_delete: 'photo_remote_delete_failed', photo_storage_cleanup: 'photo_storage_cleanup_failed',
  } as Partial<Record<RemoteTripSyncStage, string>>)[stage] ?? 'remote_trip_sync_failed';
  // Server/Storage messages can contain URLs, object keys, auth details, or credentials.
  // Expose only a local, stage-specific message; retain no raw cause on the UI error.
  const message = ({
    photo_storage_upload: 'Could not upload the photo to shared storage.',
    photo_upsert: 'Could not register the photo metadata.',
    photo_set_cover: 'Could not set the trip cover photo.',
    photo_download: 'Could not download the shared photo.',
    photo_remote_delete: 'Could not delete the shared photo record.',
    photo_storage_cleanup: 'The photo record was deleted, but its stored file could not be removed.',
  } as Partial<Record<RemoteTripSyncStage, string>>)[stage] ?? 'Could not sync trip data.';
  return new RemoteTripSyncError(code, message, stage);
}

function assertId(value: string, label: string): void {
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(value)) throw new Error(`Invalid ${label}.`);
}

async function command<T>(
  client: SupabaseClient,
  args: {
    groupDbId: string; tripId: string; action: SyncAction; entityId: string;
    payload?: Record<string, unknown>; expectedVersion: number | null; idempotencyKey?: string;
  },
): Promise<SyncCommandResult<T>> {
  assertId(args.tripId, 'trip ID');
  assertId(args.entityId, 'entity ID');
  const commandId = args.idempotencyKey ?? createIdempotencyKey();
  // The database persists idempotency results for expense/settlement RPCs. The
  // photo wrappers also perform non-transactional Storage work, so do not offer
  // whole-operation retries for those actions from this command-level error.
  const safeToResend = args.action.startsWith('expense.') || args.action.startsWith('settlement.');
  const stage = args.action === 'photo.upsert' ? 'photo_upsert' : args.action === 'photo.set_cover' ? 'photo_set_cover' : 'sync';
  let data: unknown;
  let error: unknown;
  try {
    ({ data, error } = await client.rpc('apply_group_trip_sync_change', {
      requested_group_id: args.groupDbId,
      requested_trip_id: args.tripId,
      requested_action: args.action,
      requested_entity_id: args.entityId,
      requested_payload: args.payload ?? {},
      expected_version: args.expectedVersion,
      idempotency_key: commandId,
    }));
  } catch (cause) {
    const normalized = normalizeError(cause, stage);
    throw new RemoteTripSyncError(normalized.code, normalized.message, normalized.stage, { commandId, safeToResend });
  }
  if (error) {
    const normalized = normalizeError(error, stage);
    const definitiveServerCodes = new Set([
      'authentication_required', 'trip_not_found_or_forbidden', 'invalid_sync_command',
      'idempotency_key_reused', 'sync_version_conflict', 'expense_change_forbidden',
      'expense_delete_forbidden', 'invalid_expense_payload', 'invalid_expense_member',
      'trip_settled', 'settlement_already_complete', 'settlement_not_complete',
      'invalid_settlement_entity_id', 'invalid_photo_metadata', 'photo_object_not_found',
      'photo_change_forbidden', 'photo_delete_forbidden', 'cover_photo_not_registered',
      'cover_photo_must_change_first',
    ]);
    throw new RemoteTripSyncError(normalized.code, normalized.message, normalized.stage, {
      commandId, safeToResend, remoteState: definitiveServerCodes.has(normalized.code) ? 'rejected' : 'unknown',
    });
  }
  if (!data || typeof data !== 'object' || !('eventId' in data) || typeof data.eventId !== 'string') {
    throw new RemoteTripSyncError('invalid_sync_response', 'Server returned an invalid sync result.', 'sync', { commandId, safeToResend });
  }
  return { ...(data as Omit<SyncCommandResult<T>, 'commandId'>), commandId };
}

function createIdempotencyKey(): string {
  // UUID v4; crypto.randomUUID is not available in every supported React Native runtime.
  const bytes = Array.from({ length: 16 }, () => Math.floor(Math.random() * 256));
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.map((value) => value.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/** Read all normalized records from one server-side MVCC snapshot. */
export async function loadRemoteTripSync(
  client: SupabaseClient,
  groupDbId: string,
  tripId: string,
): Promise<RemoteTripSyncSnapshot> {
  assertId(tripId, 'trip ID');
  const { data, error } = await client.rpc('load_group_trip_sync_snapshot', {
    requested_group_id: groupDbId,
    requested_trip_id: tripId,
  });
  if (error) throw normalizeError(error);
  if (!data || typeof data !== 'object') {
    throw new RemoteTripSyncError('trip_not_found_or_forbidden', 'Trip is missing or you do not have access.');
  }
  const snapshot = data as Record<string, any>;
  if (!Array.isArray(snapshot.photos) || !Array.isArray(snapshot.expenses)) {
    throw new RemoteTripSyncError('invalid_sync_snapshot', 'Server returned an invalid trip sync snapshot.');
  }
  return {
    groupRevision: Number(snapshot.groupRevision ?? 0),
    coverPhotoId: snapshot.coverPhotoId ?? undefined,
    coverVersion: Number(snapshot.coverVersion ?? 0),
    settledAt: snapshot.settledAt ?? undefined,
    settlementVersion: Number(snapshot.settlementVersion ?? 0),
    photos: snapshot.photos.map((row: Record<string, any>) => ({
      id: row.id, uri: '', storageKey: row.storageKey, mimeType: row.mimeType,
      sizeBytes: Number(row.sizeBytes), width: row.width ?? undefined, height: row.height ?? undefined,
      latitude: row.latitude ?? undefined, longitude: row.longitude ?? undefined,
      addedAt: row.addedAt, version: Number(row.version),
    })),
    expenses: snapshot.expenses.map((row: Record<string, any>) => ({
      id: row.id, title: row.title, amount: Number(row.amount),
      payerId: row.payerId, participantIds: row.participantIds,
      createdByUserId: row.createdByUserId, version: Number(row.version),
    })),
  };
}

export async function createRemoteExpense(
  client: SupabaseClient, groupDbId: string, tripId: string, expense: Expense, idempotencyKey?: string,
) {
  return command<RemoteExpense>(client, {
    groupDbId, tripId, action: 'expense.create', entityId: expense.id, payload: expense,
    expectedVersion: null, idempotencyKey,
  });
}

export async function updateRemoteExpense(
  client: SupabaseClient, groupDbId: string, tripId: string, expense: Expense, expectedVersion: number, idempotencyKey?: string,
) {
  return command<RemoteExpense>(client, {
    groupDbId, tripId, action: 'expense.update', entityId: expense.id, payload: expense,
    expectedVersion, idempotencyKey,
  });
}

export async function deleteRemoteExpense(
  client: SupabaseClient, groupDbId: string, tripId: string, expenseId: string, expectedVersion: number, idempotencyKey?: string,
) {
  return command<null>(client, { groupDbId, tripId, action: 'expense.delete', entityId: expenseId, expectedVersion, idempotencyKey });
}

export async function completeRemoteSettlement(
  client: SupabaseClient, groupDbId: string, tripId: string, expectedVersion: number, idempotencyKey?: string,
) {
  return command<RemoteSettlement>(client, {
    groupDbId, tripId, action: 'settlement.complete', entityId: tripId, expectedVersion, idempotencyKey,
  });
}

export async function reopenRemoteSettlement(
  client: SupabaseClient, groupDbId: string, tripId: string, expectedVersion: number, idempotencyKey?: string,
) {
  return command<RemoteSettlement>(client, {
    groupDbId, tripId, action: 'settlement.reopen', entityId: tripId, expectedVersion, idempotencyKey,
  });
}

/** Upload private object first, register metadata second, then set the cover with coverVersion. */
export async function uploadRemoteTripPhoto(
  client: SupabaseClient,
  groupDbId: string,
  tripId: string,
  photo: RemotePhotoInput & { bytes: Uint8Array },
  expectedPhotoVersion: number | null = null,
  idempotencyKey?: string,
): Promise<SyncCommandResult<RemotePhoto>> {
  assertId(tripId, 'trip ID');
  assertId(photo.id, 'photo ID');
  if (photo.sizeBytes !== photo.bytes.byteLength || photo.sizeBytes > MAX_PHOTO_BYTES || photo.sizeBytes < 1) {
    throw new RemoteTripSyncError('invalid_photo_size', 'Photo must be between 1 byte and 20 MiB.');
  }
  const storageKey = `${groupDbId}/${tripId}/${photo.id}`;
  let uploadError: unknown;
  try {
    ({ error: uploadError } = await client.storage.from(PHOTO_BUCKET).upload(storageKey, photo.bytes, {
      contentType: photo.mimeType, upsert: true,
    }));
  } catch (error) {
    throw normalizeError(error, 'photo_storage_upload');
  }
  if (uploadError) throw normalizeError(uploadError, 'photo_storage_upload');
  return command<RemotePhoto>(client, {
    groupDbId, tripId, action: 'photo.upsert', entityId: photo.id, expectedVersion: expectedPhotoVersion,
    idempotencyKey,
    payload: {
      storageKey, mimeType: photo.mimeType, sizeBytes: photo.sizeBytes, width: photo.width, height: photo.height,
      latitude: photo.latitude, longitude: photo.longitude, addedAt: photo.addedAt,
    },
  });
}

export async function setRemoteTripCover(
  client: SupabaseClient, groupDbId: string, tripId: string, photo: RemotePhoto, expectedCoverVersion: number,
  idempotencyKey?: string,
) {
  const { version: _version, ...metadata } = photo;
  const { id, storageKey, mimeType, sizeBytes, width, height, latitude, longitude, addedAt } = metadata;
  return command<RemotePhoto & { coverPhotoId: string }>(client, {
    groupDbId, tripId, action: 'photo.set_cover', entityId: photo.id, expectedVersion: expectedCoverVersion,
    idempotencyKey, payload: { id, storageKey, mimeType, sizeBytes, width, height, latitude, longitude, addedAt },
  });
}

export async function deleteRemoteTripPhoto(
  client: SupabaseClient, groupDbId: string, tripId: string, photoId: string, expectedVersion: number, idempotencyKey?: string,
): Promise<SyncCommandResult<{ coverPhotoId: string | null }> & {
  storageObjectDeleted: boolean; storageCleanupError?: RemoteTripSyncError;
}> {
  const snapshot = await loadRemoteTripSync(client, groupDbId, tripId);
  const photo = snapshot.photos.find((item) => item.id === photoId);
  if (!photo || photo.version !== expectedVersion) {
    throw new RemoteTripSyncError('sync_version_conflict', 'Photo is missing or has changed.');
  }
  let result: SyncCommandResult<{ coverPhotoId: string | null }>;
  try {
    result = await command<{ coverPhotoId: string | null }>(client, {
      groupDbId, tripId, action: 'photo.delete', entityId: photoId, expectedVersion, idempotencyKey,
    });
  } catch (error) {
    if (error instanceof RemoteTripSyncError) throw new RemoteTripSyncError(error.code, error.message, 'photo_remote_delete');
    throw error;
  }
  // The row is tombstoned first, so Storage RLS no longer exposes it. A cleanup failure must not
  // make callers roll back the already-committed metadata deletion.
  let cleanupError: unknown;
  try {
    ({ error: cleanupError } = await client.storage.from(PHOTO_BUCKET).remove([photo.storageKey]));
  } catch (error) {
    cleanupError = error;
  }
  return {
    ...result,
    storageObjectDeleted: !cleanupError,
    ...(cleanupError ? { storageCleanupError: normalizeError(cleanupError, 'photo_storage_cleanup') } : {}),
  };
}

/** Download bytes through authenticated Storage RLS; callers may cache them only in app-private storage. */
export async function downloadRemoteTripPhoto(client: SupabaseClient, storageKey: string): Promise<Uint8Array> {
  let data: Blob | null;
  let error: unknown;
  try {
    ({ data, error } = await client.storage.from(PHOTO_BUCKET).download(storageKey));
  } catch (caught) {
    throw normalizeError(caught, 'photo_download');
  }
  if (error) throw normalizeError(error, 'photo_download');
  if (!data) throw normalizeError(null, 'photo_download');
  const bytes = new Uint8Array(await data.arrayBuffer());
  if (bytes.byteLength < 1 || bytes.byteLength > MAX_PHOTO_BYTES) {
    throw new RemoteTripSyncError('invalid_download_size', 'Downloaded photo has an invalid size.');
  }
  return bytes;
}

/**
 * Subscribe to one group's invalidation stream. Every subscribe/reconnect and event triggers an
 * authoritative trip fetch. The consumer should ignore snapshots older than its current revision.
 */
export function subscribeRemoteTripSync(
  client: SupabaseClient,
  groupDbId: string,
  tripId: string,
  onSnapshot: (snapshot: RemoteTripSyncSnapshot, event?: RemoteSyncEvent) => void,
  onError?: (error: Error) => void,
): () => void {
  let closed = false;
  let loading = false;
  let queuedEvent: RemoteSyncEvent | undefined;
  let lastRevision = -1;
  const refresh = async (event?: RemoteSyncEvent) => {
    if (closed) return;
    if (loading) { queuedEvent = event; return; }
    loading = true;
    try {
      const snapshot = await loadRemoteTripSync(client, groupDbId, tripId);
      if (!closed && snapshot.groupRevision >= lastRevision) {
        lastRevision = snapshot.groupRevision;
        onSnapshot(snapshot, event);
      }
    } catch (error) {
      if (!closed) onError?.(error instanceof Error ? error : new Error(String(error)));
    } finally {
      loading = false;
      if (queuedEvent && !closed) {
        const nextEvent = queuedEvent;
        queuedEvent = undefined;
        void refresh(nextEvent);
      }
    }
  };
  const channel = client.channel(`group-trip-sync-${groupDbId}-${tripId}-${createIdempotencyKey()}`)
    .on('postgres_changes', {
      event: 'INSERT', schema: 'public', table: 'group_sync_events', filter: `group_id=eq.${groupDbId}`,
    }, (payload) => {
      const event = payload.new as RemoteSyncEvent;
      if (event.trip_client_id === tripId) void refresh(event);
    })
    .subscribe((status, error) => {
      if (closed) return;
      if (status === 'SUBSCRIBED') void refresh();
      else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
        onError?.(error instanceof Error ? error : new Error(`Trip sync subscription ${status.toLowerCase()}.`));
      }
    });
  return () => {
    if (closed) return;
    closed = true;
    void client.removeChannel(channel);
  };
}
