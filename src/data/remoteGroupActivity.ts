import type { SupabaseClient } from '@supabase/supabase-js';
import {
  toGroupActivityEvent,
  type ActivityRow,
  type GroupActivityEvent,
  type GroupActivityType,
} from '../domain/groupActivity';
import { supabase } from './supabase';
import { GroupActivityRpcError } from './groupActivityRpcError';

export { getGroupActivityRpcDiagnostic } from './groupActivityRpcError';

export type { GroupActivityType, GroupActivityEvent } from '../domain/groupActivity';
export type GroupActivityPage = { events: GroupActivityEvent[]; nextCursor: string | null };
export type GroupActivityOptions = { tripId?: string; limit?: number; cursor?: string | null };

const GROUP_ACTIVITY_RPC_NAME = 'list_group_trip_activity' as const;

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TRIP_ID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/;

function isActivityRow(value: unknown): value is ActivityRow {
  if (typeof value !== 'object' || value === null) return false;
  const row = value as Record<string, unknown>;
  return typeof row.id === 'string' && UUID_PATTERN.test(row.id) &&
    typeof row.group_id === 'string' && UUID_PATTERN.test(row.group_id) &&
    typeof row.trip_client_id === 'string' && TRIP_ID_PATTERN.test(row.trip_client_id) &&
    typeof row.action === 'string' &&
    typeof row.created_at === 'string' && !Number.isNaN(Date.parse(row.created_at)) &&
    (row.actor_display_name === null || row.actor_display_name === undefined || typeof row.actor_display_name === 'string') &&
    (row.expense_title === null || row.expense_title === undefined || typeof row.expense_title === 'string') &&
    (row.expense_amount_krw === null || row.expense_amount_krw === undefined ||
      typeof row.expense_amount_krw === 'number' || typeof row.expense_amount_krw === 'string') &&
    (row.next_cursor === null || row.next_cursor === undefined || typeof row.next_cursor === 'string');
}

/** Reads a server-scoped activity page; the RPC enforces active membership and trip access. */
export async function listGroupActivity(
  groupDbId: string,
  options: GroupActivityOptions = {},
  client: SupabaseClient | null = supabase,
): Promise<GroupActivityPage> {
  if (!client) throw new Error('Supabase is not configured.');
  if (!UUID_PATTERN.test(groupDbId)) throw new Error('Invalid group ID.');
  if (options.tripId === undefined || !TRIP_ID_PATTERN.test(options.tripId)) throw new Error('Invalid trip ID.');
  if (options.cursor != null && (typeof options.cursor !== 'string' || options.cursor.length > 256)) {
    throw new Error('Invalid group activity cursor.');
  }
  const requestedLimit = options.limit ?? 5;
  const limit = Number.isFinite(requestedLimit) ? Math.max(1, Math.min(5, Math.trunc(requestedLimit))) : 5;
  const result = await client.rpc(GROUP_ACTIVITY_RPC_NAME, {
    requested_group_id: groupDbId,
    requested_trip_id: options.tripId,
    requested_limit: limit,
    requested_cursor: options.cursor ?? null,
  });
  if (result.error) throw new GroupActivityRpcError(result.error);
  if (!Array.isArray(result.data) || result.data.length > 5 || !result.data.every(isActivityRow) ||
      !result.data.every((row) => row.group_id === groupDbId && row.trip_client_id === options.tripId)) {
    throw new Error('Invalid group activity response.');
  }

  const rows = result.data as ActivityRow[];
  const events = rows.map(toGroupActivityEvent).filter((event): event is GroupActivityEvent => event !== null);
  const lastCursor = rows.at(-1)?.next_cursor;
  const nextCursor = typeof lastCursor === 'string' && lastCursor.length > 0 && lastCursor.length <= 256
    ? lastCursor
    : null;
  return { events, nextCursor };
}
