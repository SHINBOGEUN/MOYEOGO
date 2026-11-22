export const GROUP_ACTIVITY_TYPES = [
  'photo_added',
  'photo_cover_changed',
  'photo_removed',
  'expense_added',
  'expense_updated',
  'expense_removed',
  'settlement_completed',
  'settlement_reopened',
] as const;

export type GroupActivityType = (typeof GROUP_ACTIVITY_TYPES)[number];
export type GroupActivityEvent = {
  id: string;
  type: GroupActivityType;
  occurredAt: string;
  groupId: string;
  tripId: string;
  actor: { displayName: string } | null;
  expense: { title: string; amountKrw: number } | null;
};
export type ActivityRow = {
  id: string;
  group_id: string;
  trip_client_id: string;
  action: string;
  created_at: string;
  actor_display_name: string | null;
  expense_title?: string | null;
  expense_amount_krw?: number | string | null;
  next_cursor?: string | null;
};

const ACTION_TYPES: Record<string, GroupActivityType> = {
  'photo.upsert': 'photo_added',
  'photo.set_cover': 'photo_cover_changed',
  'photo.delete': 'photo_removed',
  'expense.create': 'expense_added',
  'expense.update': 'expense_updated',
  'expense.delete': 'expense_removed',
  'settlement.complete': 'settlement_completed',
  'settlement.reopen': 'settlement_reopened',
};

function safeExpenseAmount(value: ActivityRow['expense_amount_krw']): number | null {
  if (typeof value === 'number') {
    return Number.isSafeInteger(value) && value > 0 ? value : null;
  }
  if (typeof value !== 'string' || !/^[1-9]\d*$/.test(value)) return null;
  const amount = Number(value);
  return Number.isSafeInteger(amount) && amount > 0 ? amount : null;
}

export function toGroupActivityEvent(row: ActivityRow): GroupActivityEvent | null {
  const type = ACTION_TYPES[row.action];
  if (!type) return null;
  const title = row.action === 'expense.create' && typeof row.expense_title === 'string' && row.expense_title.trim()
    ? row.expense_title.trim()
    : null;
  const amountKrw = row.action === 'expense.create' ? safeExpenseAmount(row.expense_amount_krw) : null;
  return {
    id: row.id,
    type,
    occurredAt: new Date(row.created_at).toISOString(),
    groupId: row.group_id,
    tripId: row.trip_client_id,
    actor: typeof row.actor_display_name === 'string' && row.actor_display_name.trim()
      ? { displayName: row.actor_display_name.trim() }
      : null,
    expense: title && amountKrw !== null ? { title, amountKrw } : null,
  };
}
