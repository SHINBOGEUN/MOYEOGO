import Storage from 'expo-sqlite/kv-store';
import type { Expense, Member } from '../domain/settlement';
import type { Group, Trip, TripPhoto } from '../domain/models';

const LEGACY_STORAGE_KEY = 'moyeogo:groups:snapshot:v1';
const ACCOUNT_STORAGE_KEY_PREFIX = 'moyeogo:groups:user:';
const SCHEMA_VERSION = 1;

export interface GroupStore {
  loadAll(): Promise<Group[]>;
  saveAll(groups: Group[]): Promise<void>;
  loadDeletedGroupIds(): Promise<string[]>;
  saveDeletedGroupIds(ids: string[]): Promise<void>;
}

type StoredSnapshot = {
  schemaVersion: number;
  groups: Group[];
};

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isMember(value: unknown): value is Member {
  return isObject(value) && typeof value.id === 'string' && typeof value.name === 'string';
}

function isExpense(value: unknown): value is Expense {
  return isObject(value)
    && typeof value.id === 'string'
    && typeof value.title === 'string'
    && typeof value.amount === 'number'
    && Number.isSafeInteger(value.amount)
    && typeof value.payerId === 'string'
    && Array.isArray(value.participantIds)
    && value.participantIds.every((id) => typeof id === 'string');
}

function isTripPhoto(value: unknown): value is TripPhoto {
  return isObject(value)
    && typeof value.id === 'string'
    && typeof value.uri === 'string'
    && typeof value.addedAt === 'string'
    && (value.latitude === undefined || (typeof value.latitude === 'number' && Number.isFinite(value.latitude)))
    && (value.longitude === undefined || (typeof value.longitude === 'number' && Number.isFinite(value.longitude)));
}

function isTrip(value: unknown): value is Trip {
  return isObject(value)
    && typeof value.id === 'string'
    && typeof value.name === 'string'
    && typeof value.destination === 'string'
    && typeof value.detailAddress === 'string'
    && typeof value.dateRange === 'string'
    && typeof value.treasurerId === 'string'
    && (value.startedAt === undefined || typeof value.startedAt === 'string')
    && (value.endedAt === undefined || typeof value.endedAt === 'string')
    && (value.photos === undefined || (Array.isArray(value.photos) && value.photos.every(isTripPhoto)))
    && (value.coverPhotoId === undefined || typeof value.coverPhotoId === 'string')
    && (value.settledAt === undefined || typeof value.settledAt === 'string')
    && Array.isArray(value.expenses)
    && value.expenses.every(isExpense);
}

function isGroup(value: unknown): value is Group {
  return isObject(value)
    && typeof value.id === 'string'
    && typeof value.name === 'string'
    && Array.isArray(value.members)
    && value.members.every(isMember)
    && Array.isArray(value.trips)
    && value.trips.every(isTrip);
}

function parseSnapshot(raw: string): Group[] {
  const parsed: unknown = JSON.parse(raw);
  if (!isObject(parsed) || parsed.schemaVersion !== SCHEMA_VERSION || !Array.isArray(parsed.groups) || !parsed.groups.every(isGroup)) {
    throw new Error('저장 데이터의 형식이 올바르지 않습니다.');
  }
  return parsed.groups;
}

let pendingWrite: Promise<void> = Promise.resolve();

function createGroupStore(storageKey: string): GroupStore {
  const deletedGroupIdsKey = `${storageKey}:deleted-ids:v1`;
  return {
    async loadAll() {
      const raw = await Storage.getItem(storageKey);
      if (raw === null) return [];
      return parseSnapshot(raw);
    },

    saveAll(groups) {
      const snapshot: StoredSnapshot = { schemaVersion: SCHEMA_VERSION, groups };
      const serialized = JSON.stringify(snapshot);
      const nextWrite = pendingWrite.catch(() => undefined).then(() => Storage.setItem(storageKey, serialized));
      pendingWrite = nextWrite;
      return nextWrite;
    },

    async loadDeletedGroupIds() {
      const raw = await Storage.getItem(deletedGroupIdsKey);
      if (raw === null) return [];
      const parsed: unknown = JSON.parse(raw);
      if (!Array.isArray(parsed) || !parsed.every((id) => typeof id === 'string')) {
        throw new Error('삭제한 모임 목록을 읽을 수 없습니다.');
      }
      return parsed;
    },

    async saveDeletedGroupIds(ids) {
      await Storage.setItem(deletedGroupIdsKey, JSON.stringify([...new Set(ids)]));
    },
  };
}

/** Pre-account data is kept intact and is never implicitly assigned to a newly signed-in user. */
export const localGroupStore: GroupStore = createGroupStore(LEGACY_STORAGE_KEY);

/** Each Supabase user gets a separate local dataset on this device. */
export function createAccountGroupStore(userId: string): GroupStore {
  const normalizedUserId = userId.trim();
  if (!normalizedUserId) throw new Error('로그인한 계정 ID가 필요합니다.');
  return createGroupStore(`${ACCOUNT_STORAGE_KEY_PREFIX}${encodeURIComponent(normalizedUserId)}:snapshot:v1`);
}
