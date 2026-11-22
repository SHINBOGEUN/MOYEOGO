import type { Group, Trip } from '../domain/models';

export function appendTripPhotos(current: import('../domain/models').TripPhoto[], added: import('../domain/models').TripPhoto[]) {
  return [...current, ...added];
}

export class TripPhotoBatchError extends Error {
  readonly cleanupFailures: number;

  constructor(cleanupFailures: number) {
    super('Trip photo batch copy failed');
    this.name = 'TripPhotoBatchError';
    this.cleanupFailures = cleanupFailures;
  }
}

export async function copyTripPhotoBatch<T>(
  items: readonly T[],
  copyItem: (item: T) => Promise<{ value: import('../domain/models').TripPhoto; uri: string }>,
  deleteFile: (uri: string) => void | Promise<void>,
): Promise<import('../domain/models').TripPhoto[]> {
  const createdUris: string[] = [];
  const copied: import('../domain/models').TripPhoto[] = [];

  try {
    for (const item of items) {
      const result = await copyItem(item);
      createdUris.push(result.uri);
      copied.push(result.value);
    }
    return copied;
  } catch {
    const cleanup = await Promise.allSettled(createdUris.map((uri) => deleteFile(uri)));
    throw new TripPhotoBatchError(cleanup.filter((result) => result.status === 'rejected').length);
  }
}

export function removeTripPhoto(current: import('../domain/models').TripPhoto[], photoId: string) {
  return current.filter((photo) => photo.id !== photoId);
}

/** Keep this device's photo paths only for photos still present in the matching remote trip. */
export function preserveLocalGroupPhotoUris(remoteGroups: Group[], localGroups: Group[]): Group[] {
  const localByGroupId = new Map(localGroups.map((group) => [group.id, group]));
  return remoteGroups.map((remoteGroup) => {
    const localGroup = localByGroupId.get(remoteGroup.id);
    if (!localGroup) return remoteGroup;
    const localTrips = new Map(localGroup.trips.map((trip) => [trip.id, trip]));
    return {
      ...remoteGroup,
      trips: remoteGroup.trips.map((remoteTrip) => preserveTripPhotoUris(remoteTrip, localTrips.get(remoteTrip.id))),
    };
  });
}

function preserveTripPhotoUris(remoteTrip: Trip, localTrip?: Trip): Trip {
  if (!localTrip || !localTrip.photos?.length) return remoteTrip;
  const localPhotos = new Map(localTrip.photos.map((photo) => [photo.id, photo]));
  const remotePhotos = remoteTrip.photos ?? [];
  const remotePhotoIds = new Set(remotePhotos.map((photo) => photo.id));
  return {
    ...remoteTrip,
    photos: [
      ...remotePhotos.map((remotePhoto) => {
      const localPhoto = localPhotos.get(remotePhoto.id);
      return remotePhoto.uri || !localPhoto?.uri ? remotePhoto : { ...remotePhoto, uri: localPhoto.uri };
      }),
      ...localTrip.photos.filter((photo) => !remotePhotoIds.has(photo.id)),
    ],
    ...(remoteTrip.coverPhotoId === undefined && localTrip.coverPhotoId !== undefined
      ? { coverPhotoId: localTrip.coverPhotoId }
      : {}),
  };
}
