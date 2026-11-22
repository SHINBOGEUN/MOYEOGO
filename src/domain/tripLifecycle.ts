import type { Trip } from './models';

export type TripPhase = 'planned' | 'inProgress' | 'ended';

export function getTripPhase(trip: Pick<Trip, 'startedAt' | 'endedAt' | 'settledAt'>): TripPhase {
  if (trip.endedAt || trip.settledAt) return 'ended';
  if (trip.startedAt) return 'inProgress';
  return 'planned';
}
