import type { Group, Trip, TripPhoto } from './models';
import type { RemoteTripSyncSnapshot } from '../data/remoteTripSync';

/** Merge normalized shared entities without replacing the trip's local snapshot fields. */
export function mergeRemoteTripSyncSnapshot(trip: Trip, snapshot: RemoteTripSyncSnapshot): Trip {
  const localPhotos = new Map((trip.photos ?? []).map((photo) => [photo.id, photo]));
  const remotePhotoIds = new Set(snapshot.photos.map((photo) => photo.id));
  const remotePhotos: TripPhoto[] = snapshot.photos.map((photo) => ({
    ...photo,
    uri: localPhotos.get(photo.id)?.uri ?? '',
  }));
  const localOnlyPhotos = (trip.photos ?? []).filter((photo) => photo.version === undefined && !remotePhotoIds.has(photo.id));
  const localExpenses = trip.expenses.filter((expense) => expense.version === undefined);
  const remoteExpenses = snapshot.expenses.map((expense) => ({ ...expense }));

  return {
    ...trip,
    photos: [...remotePhotos, ...localOnlyPhotos],
    expenses: [...remoteExpenses, ...localExpenses],
    coverPhotoId: snapshot.coverPhotoId,
    settledAt: snapshot.settledAt,
    syncRevision: snapshot.groupRevision,
  };
}

/** Keep normalized sync entities when a legacy full-group snapshot refreshes. */
export function preserveTripSyncEntities(remoteGroups: Group[], localGroups: Group[]): Group[] {
  const localByGroupId = new Map(localGroups.map((group) => [group.id, group]));
  return remoteGroups.map((remoteGroup) => {
    const localGroup = localByGroupId.get(remoteGroup.id);
    if (!localGroup) return remoteGroup;
    const localTrips = new Map(localGroup.trips.map((trip) => [trip.id, trip]));
    return {
      ...remoteGroup,
      trips: remoteGroup.trips.map((remoteTrip) => {
        const localTrip = localTrips.get(remoteTrip.id);
        if (localTrip?.syncRevision === undefined) return remoteTrip;
        const localExpensesById = new Map(localTrip.expenses.map((expense) => [expense.id, expense]));
        const remoteExpenseIds = new Set(remoteTrip.expenses.map((expense) => expense.id));
        return {
          ...remoteTrip,
          expenses: [
            ...remoteTrip.expenses.map((expense) => localExpensesById.get(expense.id)?.version !== undefined
              ? localExpensesById.get(expense.id)!
              : expense),
            ...localTrip.expenses.filter((expense) => !remoteExpenseIds.has(expense.id)),
          ],
          photos: localTrip.photos,
          coverPhotoId: localTrip.coverPhotoId,
          settledAt: localTrip.settledAt,
          syncRevision: localTrip.syncRevision,
        };
      }),
    };
  });
}
