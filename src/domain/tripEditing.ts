import type { Trip } from './models';

export type EditableTripDetails = Pick<Trip, 'name' | 'destination' | 'detailAddress' | 'dateRange' | 'treasurerId'>;

export function parseTripDateRange(dateRange: string): { startDate: Date; endDate: Date } | null {
  const matches = [...dateRange.matchAll(/(\d{4})\.\s*(\d{1,2})\.\s*(\d{1,2})\./g)];
  if (matches.length < 2) return null;

  const toDate = (match: RegExpMatchArray) => {
    const year = Number(match[1]);
    const month = Number(match[2]);
    const day = Number(match[3]);
    const date = new Date(year, month - 1, day);
    if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) return null;
    return date;
  };

  const startDate = toDate(matches[0]);
  const endDate = toDate(matches[1]);
  if (!startDate || !endDate || startDate > endDate) return null;
  return { startDate, endDate };
}

export function withUpdatedTripDetails(trip: Trip, details: EditableTripDetails): Trip {
  return { ...trip, ...details };
}
