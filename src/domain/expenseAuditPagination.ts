import type { ExpenseChangeHistoryItem } from '../data/remoteGroupExpenseAudit';

/** Appends a cursor page without displaying an event more than once. */
export function appendExpenseAuditPage(
  current: ExpenseChangeHistoryItem[],
  incoming: ExpenseChangeHistoryItem[],
): ExpenseChangeHistoryItem[] {
  const seen = new Set(current.map((item) => item.eventKey));
  return [...current, ...incoming.filter((item) => {
    if (seen.has(item.eventKey)) return false;
    seen.add(item.eventKey);
    return true;
  })];
}
