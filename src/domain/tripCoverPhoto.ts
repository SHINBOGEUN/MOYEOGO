import type { Trip, TripPhoto } from './models';

export const TRIP_FALLBACK_COVER_ORDER = [2, 1, 3, 4, 5] as const;

export function getTripCoverPhoto(photos: TripPhoto[] | undefined, coverPhotoId?: string): TripPhoto | undefined {
  if (!photos?.length) return undefined;
  return photos.find((photo) => photo.id === coverPhotoId) ?? photos[0];
}

export function getTripFallbackCoverOption(trips: Array<Pick<Trip, 'photos' | 'coverPhotoId'>>, tripIndex: number): number | undefined {
  const currentTrip = trips[tripIndex];
  if (!currentTrip || getTripCoverPhoto(currentTrip.photos, currentTrip.coverPhotoId)) return undefined;

  const earlierPhotoFreeTrips = trips
    .slice(0, tripIndex)
    .filter((trip) => !getTripCoverPhoto(trip.photos, trip.coverPhotoId))
    .length;
  return TRIP_FALLBACK_COVER_ORDER[earlierPhotoFreeTrips % TRIP_FALLBACK_COVER_ORDER.length];
}
