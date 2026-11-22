import test from 'node:test';
import assert from 'node:assert/strict';
import { coordinatesFromExif } from '../src/domain/photoLocation.ts';
import { getTripPhase } from '../src/domain/tripLifecycle.ts';
import { getMillisecondsUntilNextSeoulDay, getTripDday } from '../src/domain/tripDday.ts';
import { getTripCoverPhoto, getTripFallbackCoverOption } from '../src/domain/tripCoverPhoto.ts';
import { parseTripDateRange, withUpdatedTripDetails } from '../src/domain/tripEditing.ts';
import { appendTripPhotos, copyTripPhotoBatch, preserveLocalGroupPhotoUris, removeTripPhoto, TripPhotoBatchError } from '../src/data/localGroupPhotos.ts';

test('remote refresh merges matching photos and keeps the local URI for the same photo ID', () => {
  const local = [{ id: 'g1', name: 'Group', members: [], trips: [{ id: 't1', name: 'Trip', expenses: [], photos: [
    { id: 'same', uri: 'file:///device/same.jpg', addedAt: 'then' },
    { id: 'removed-remotely', uri: 'file:///device/gone.jpg', addedAt: 'then' },
  ] }] }];
  const remote = [{ id: 'g1', name: 'Group', members: [], trips: [{ id: 't1', name: 'Trip', expenses: [], photos: [
    { id: 'same', uri: '', addedAt: 'then' },
    { id: 'other-device', uri: '', addedAt: 'then' },
  ] }, { id: 't2', name: 'Other trip', expenses: [], photos: [{ id: 'same', uri: '', addedAt: 'then' }] }] }];
  const merged = preserveLocalGroupPhotoUris(remote, local);
  assert.equal(merged[0].trips[0].photos[0].uri, 'file:///device/same.jpg');
  assert.equal(merged[0].trips[0].photos[1].uri, '');
  assert.equal(merged[0].trips[0].photos[2].uri, 'file:///device/gone.jpg');
  assert.equal(merged[0].trips[1].photos[0].uri, '');
  assert.equal(preserveLocalGroupPhotoUris([{ ...remote[0], id: 'g2' }], local)[0].trips[0].photos[0].uri, '');
});

test('remote refresh keeps locally stored photos missing from a partial or empty remote list', () => {
  const localPhoto = { id: 'local-only', uri: 'file:///device/trip/local-only.jpg', addedAt: 'then' };
  const local = [{ id: 'g1', name: 'Group', members: [], trips: [{
    id: 't1', name: 'Trip', expenses: [], photos: [localPhoto], coverPhotoId: localPhoto.id,
  }] }];
  const remote = [{ id: 'g1', name: 'Group', members: [], trips: [{ id: 't1', name: 'Trip', expenses: [], photos: [
    { id: 'remote-only', uri: '', addedAt: 'then' },
  ] }] }];

  const refreshed = preserveLocalGroupPhotoUris(remote, local);
  assert.deepEqual(refreshed[0].trips[0].photos, [remote[0].trips[0].photos[0], localPhoto]);
  assert.equal(refreshed[0].trips[0].coverPhotoId, localPhoto.id);
  const emptyRemote = [{ id: 'g1', name: 'Group', members: [], trips: [{ id: 't1', name: 'Trip', expenses: [], photos: [] }] }];
  assert.deepEqual(preserveLocalGroupPhotoUris(emptyRemote, local)[0].trips[0].photos, [localPhoto]);
});

test('photo additions use latest list; cancellation or failed copy can leave it untouched', () => {
  const first = { id: 'first', uri: 'file:///first.jpg', addedAt: 'then' };
  const second = { id: 'second', uri: 'file:///second.jpg', addedAt: 'then' };
  const latest = [first];
  assert.deepEqual(appendTripPhotos(latest, [second]), [first, second]);
  assert.deepEqual(latest, [first]);
  // Picker cancellation and a copy exception do not invoke the onChange updater.
  assert.deepEqual(latest, [first]);
});

test('a failed multi-photo copy removes only files created by this batch and reports cleanup failures', async () => {
  const created = [];
  let calls = 0;
  await assert.rejects(copyTripPhotoBatch(['first', 'second'], async (item) => {
    calls += 1;
    if (item === 'second') throw new Error('copy failed');
    created.push('file:///batch/first.jpg');
    return { value: { id: 'first', uri: 'file:///batch/first.jpg', addedAt: 'then' }, uri: 'file:///batch/first.jpg' };
  }, async (uri) => {
    assert.equal(uri, 'file:///batch/first.jpg');
    throw new Error('cleanup failed');
  }), (error) => {
    assert.ok(error instanceof TripPhotoBatchError);
    assert.equal(error.cleanupFailures, 1);
    return true;
  });
  assert.equal(calls, 2);
  assert.deepEqual(created, ['file:///batch/first.jpg']);
});

test('photo removal targets the current list and leaves it intact when deletion fails', () => {
  const photos = [
    { id: 'keep', uri: 'file:///keep.jpg', addedAt: 'then' },
    { id: 'remove', uri: 'file:///remove.jpg', addedAt: 'then' },
  ];
  assert.deepEqual(removeTripPhoto(photos, 'remove'), [photos[0]]);
  assert.equal(photos.length, 2);
  // A file deletion exception exits before this updater is called.
  assert.deepEqual(photos, [photos[0], photos[1]]);
});

test('trip cover uses the explicitly selected photo, otherwise the first added photo', () => {
  const first = { id: 'first', uri: 'file:///first.jpg', addedAt: '2026-10-01T00:00:00.000Z' };
  const second = { id: 'second', uri: 'file:///second.jpg', addedAt: '2026-10-02T00:00:00.000Z' };
  assert.equal(getTripCoverPhoto([first, second], 'second'), second);
  assert.equal(getTripCoverPhoto([first, second]), first);
  assert.equal(getTripCoverPhoto([first, second], 'deleted-photo'), first);
  assert.equal(getTripCoverPhoto([]), undefined);
});

test('empty trip covers follow 2-1-3-4-5 and trips with photos do not consume the order', () => {
  const photo = [{ id: 'photo', uri: 'file:///trip.jpg', addedAt: '2026-10-01T00:00:00.000Z' }];
  const trips = [
    { photos: [] },
    { photos: photo },
    { photos: photo },
    { photos: [] },
    { photos: [] },
    { photos: [] },
    { photos: [] },
    { photos: [] },
  ];
  assert.deepEqual(trips.map((_, index) => getTripFallbackCoverOption(trips, index)), [2, undefined, undefined, 1, 3, 4, 5, 2]);
});

test('EXIF GPS degrees/minutes/seconds are converted to map coordinates', () => {
  const location = coordinatesFromExif({
    GPSLatitude: [{ numerator: 37, denominator: 1 }, { numerator: 33, denominator: 1 }, { numerator: 0, denominator: 1 }],
    GPSLatitudeRef: 'N',
    GPSLongitude: [126, 58, 0],
    GPSLongitudeRef: 'W',
  });
  assert.deepEqual(location, { latitude: 37.55, longitude: -126.96666666666667 });
});

test('missing or invalid GPS coordinates are not mapped', () => {
  assert.equal(coordinatesFromExif(null), undefined);
  assert.equal(coordinatesFromExif({ GPSLatitude: 91, GPSLongitude: 128 }), undefined);
});

test('trip phase follows explicit start and end timestamps', () => {
  assert.equal(getTripPhase({}), 'planned');
  assert.equal(getTripPhase({ startedAt: '2026-10-09T00:00:00.000Z' }), 'inProgress');
  assert.equal(getTripPhase({ startedAt: '2026-10-09T00:00:00.000Z', endedAt: '2026-10-09T12:00:00.000Z' }), 'ended');
  assert.equal(getTripPhase({ settledAt: '2026-10-09T12:00:00.000Z' }), 'ended');
});

test('D-day changes at Asia/Seoul midnight and schedules the next date boundary', () => {
  const beforeMidnight = new Date('2026-10-21T14:59:59.000Z');
  const atMidnight = new Date('2026-10-21T15:00:00.000Z');
  const trip = '2026. 10. 22. - 2026. 10. 23.';

  assert.equal(getTripDday(trip, beforeMidnight), 1);
  assert.equal(getTripDday(trip, atMidnight), 0);
  assert.equal(getMillisecondsUntilNextSeoulDay(beforeMidnight), 1_000);
  assert.equal(getMillisecondsUntilNextSeoulDay(atMidnight), 86_400_000);
  assert.equal(getTripDday(trip, new Date('2026-10-22T15:00:00.000Z')), -1);
});

test('trip date ranges can be restored into editable calendar dates', () => {
  const dates = parseTripDateRange('2026. 10. 10. - 2026. 10. 12.');
  assert.equal(dates.startDate.getFullYear(), 2026);
  assert.equal(dates.startDate.getMonth(), 9);
  assert.equal(dates.startDate.getDate(), 10);
  assert.equal(dates.endDate.getDate(), 12);
  assert.equal(parseTripDateRange('잘못된 날짜'), null);
  assert.equal(parseTripDateRange('2026. 02. 31. - 2026. 03. 02.'), null);
});

test('editing trip details preserves expenses, photos, lifecycle, and settlement data', () => {
  const original = {
    id: 'trip-1',
    name: '강릉 바다 여행',
    destination: '강원특별자치도 강릉시',
    detailAddress: '경포대',
    dateRange: '2026. 10. 10. - 2026. 10. 12.',
    treasurerId: 'member-1',
    expenses: [{ id: 'expense-1', title: '저녁', amount: 24000, payerId: 'member-1', participantIds: ['member-1', 'member-2'] }],
    startedAt: '2026-10-10T01:00:00.000Z',
    endedAt: '2026-10-12T05:00:00.000Z',
    photos: [{ id: 'photo-1', uri: 'file:///trip.jpg', addedAt: '2026-10-10T04:00:00.000Z', latitude: 37.8, longitude: 128.9 }],
    coverPhotoId: 'photo-1',
    settledAt: '2026-10-12T06:00:00.000Z',
  };
  const updated = withUpdatedTripDetails(original, {
    name: '강릉 바다 여행 2',
    destination: '강원특별자치도 강릉시 주문진읍',
    detailAddress: '주문진 해변',
    dateRange: '2026. 10. 11. - 2026. 10. 13.',
    treasurerId: 'member-2',
  });

  assert.equal(updated.name, '강릉 바다 여행 2');
  assert.equal(updated.destination, '강원특별자치도 강릉시 주문진읍');
  assert.deepEqual(updated.expenses, original.expenses);
  assert.deepEqual(updated.photos, original.photos);
  assert.equal(updated.startedAt, original.startedAt);
  assert.equal(updated.endedAt, original.endedAt);
  assert.equal(updated.coverPhotoId, original.coverPhotoId);
  assert.equal(updated.settledAt, original.settledAt);
});
