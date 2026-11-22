import type { GroupActivityEvent } from './groupActivity';

/** Append a cursor page without rendering an event more than once. */
export function appendGroupActivityPage(
  current: GroupActivityEvent[],
  incoming: GroupActivityEvent[],
): GroupActivityEvent[] {
  const seen = new Set(current.map((event) => event.id));
  return [...current, ...incoming.filter((event) => {
    if (seen.has(event.id)) return false;
    seen.add(event.id);
    return true;
  })];
}
