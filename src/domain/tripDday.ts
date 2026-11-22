const SEOUL_TIME_ZONE = 'Asia/Seoul';

function getDateParts(dateRange: string): [number, number, number] | null {
  const match = dateRange.match(/(\d{4})\.\s*(\d{1,2})\.\s*(\d{1,2})\./);
  if (!match) return null;
  const parts: [number, number, number] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const [year, month, day] = parts;
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null;
  return parts;
}

function getSeoulToday(now: Date): [number, number, number] {
  const values = new Intl.DateTimeFormat('en-US', {
    timeZone: SEOUL_TIME_ZONE,
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
  }).formatToParts(now);
  const part = (type: 'year' | 'month' | 'day') => Number(values.find((value) => value.type === type)?.value);
  return [part('year'), part('month'), part('day')];
}

/** Milliseconds until the next Asia/Seoul calendar day begins. */
export function getMillisecondsUntilNextSeoulDay(now: Date): number {
  const [year, month, day] = getSeoulToday(now);
  const nextSeoulMidnightUtc = Date.UTC(year, month - 1, day + 1) - 9 * 60 * 60 * 1000;
  return Math.max(0, nextSeoulMidnightUtc - now.getTime());
}

/** Difference in calendar days between the trip start and today's Asia/Seoul date. */
export function getTripDday(dateRange: string, now: Date = new Date()): number | null {
  const startDate = getDateParts(dateRange);
  if (!startDate || !Number.isFinite(now.getTime())) return null;
  const [startYear, startMonth, startDay] = startDate;
  const [todayYear, todayMonth, todayDay] = getSeoulToday(now);
  return Math.round((Date.UTC(startYear, startMonth - 1, startDay) - Date.UTC(todayYear, todayMonth - 1, todayDay)) / 86_400_000);
}

export function formatTripDday(days: number): string {
  if (days === 0) return 'D-Day';
  return days > 0 ? `D-${days}` : `D+${Math.abs(days)}`;
}
