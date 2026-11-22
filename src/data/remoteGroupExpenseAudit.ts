import type { SupabaseClient } from '@supabase/supabase-js';

export type ExpenseAuditAction =
  | 'expense.create' | 'expense.update' | 'expense.delete'
  | 'settlement.complete' | 'settlement.reopen';

export type ExpenseAuditSnapshot = {
  title: string;
  amountKrw: number;
  split: { participantCount: number; totalAmountKrw: number };
};

export type ExpenseChangeHistoryItem = {
  eventKey: string;
  action: ExpenseAuditAction;
  occurredAt: string;
  actorDisplayName: string | null;
  before: ExpenseAuditSnapshot | null;
  after: ExpenseAuditSnapshot | null;
};

export type ExpenseChangeHistoryPage = {
  items: ExpenseChangeHistoryItem[];
  nextCursor: string | null;
};

export type ExpenseChangeHistoryOptions = { limit?: number; cursor?: string | null };

type ExpenseAuditRow = {
  event_key: string;
  action: string;
  occurred_at: string;
  actor_display_name: string | null;
  before_title: string | null;
  before_amount_krw: number | null;
  before_participant_count: number | null;
  before_total_amount_krw: number | null;
  after_title: string | null;
  after_amount_krw: number | null;
  after_participant_count: number | null;
  after_total_amount_krw: number | null;
  next_cursor: string | null;
};

const ACTIONS = new Set<ExpenseAuditAction>([
  'expense.create', 'expense.update', 'expense.delete',
  'settlement.complete', 'settlement.reopen',
]);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function snapshot(
  title: string | null,
  amountKrw: number | null,
  participantCount: number | null,
  totalAmountKrw: number | null,
): ExpenseAuditSnapshot | null {
  if (title === null && amountKrw === null && participantCount === null && totalAmountKrw === null) return null;
  if (typeof title !== 'string' || typeof amountKrw !== 'number' || !Number.isSafeInteger(amountKrw) ||
      typeof participantCount !== 'number' || !Number.isSafeInteger(participantCount) || participantCount < 0 ||
      typeof totalAmountKrw !== 'number' || !Number.isSafeInteger(totalAmountKrw)) {
    throw new Error('Invalid expense audit response.');
  }
  return { title, amountKrw, split: { participantCount, totalAmountKrw } };
}

function mapRow(value: unknown): { item: ExpenseChangeHistoryItem; nextCursor: string | null } {
  if (typeof value !== 'object' || value === null) throw new Error('Invalid expense audit response.');
  const row = value as ExpenseAuditRow;
  if (!/^[a-f0-9]{32}$/.test(row.event_key) || !ACTIONS.has(row.action as ExpenseAuditAction) ||
      typeof row.occurred_at !== 'string' || Number.isNaN(Date.parse(row.occurred_at)) ||
      (row.actor_display_name !== null && typeof row.actor_display_name !== 'string') ||
      (row.next_cursor !== null && typeof row.next_cursor !== 'string')) {
    throw new Error('Invalid expense audit response.');
  }
  return {
    item: {
      eventKey: row.event_key,
      action: row.action as ExpenseAuditAction,
      occurredAt: new Date(row.occurred_at).toISOString(),
      actorDisplayName: row.actor_display_name,
      before: snapshot(row.before_title, row.before_amount_krw, row.before_participant_count, row.before_total_amount_krw),
      after: snapshot(row.after_title, row.after_amount_krw, row.after_participant_count, row.after_total_amount_krw),
    },
    nextCursor: row.next_cursor,
  };
}

/** Reads the dedicated server projection; the private audit table is never queried directly. */
export async function listGroupExpenseAudit(
  groupDbId: string,
  tripId: string,
  options: ExpenseChangeHistoryOptions = {},
  client?: SupabaseClient | null,
): Promise<ExpenseChangeHistoryPage> {
  const activeClient = client === undefined ? (await import('./supabase')).supabase : client;
  if (!activeClient) throw new Error('Supabase is not configured.');
  if (!UUID.test(groupDbId) || !/^[A-Za-z0-9_-]{1,128}$/.test(tripId)) {
    throw new Error('Invalid group or trip ID.');
  }
  const requestedLimit = options.limit ?? 20;
  const limit = Number.isFinite(requestedLimit) ? Math.max(1, Math.min(50, Math.trunc(requestedLimit))) : 20;
  if (options.cursor != null && (options.cursor.length > 256 || !/^[A-Za-z0-9+/]+={0,2}$/.test(options.cursor))) {
    throw new Error('Invalid expense history cursor.');
  }
  let result;
  try {
    result = await activeClient.rpc('list_group_expense_audit', {
      requested_group_id: groupDbId,
      requested_trip_id: tripId,
      requested_limit: limit,
      requested_cursor: options.cursor ?? null,
    });
  } catch {
    throw new Error('Could not load expense change history.');
  }
  if (result.error) throw new Error('Could not load expense change history.');
  const rows = (result.data ?? []) as unknown[];
  const mapped = rows.map(mapRow);
  return {
    items: mapped.map(({ item }) => item),
    nextCursor: mapped.at(-1)?.nextCursor ?? null,
  };
}
