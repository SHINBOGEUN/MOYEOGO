import assert from 'node:assert/strict';
import test from 'node:test';
import {
  toGroupActivityEvent,
} from '../src/domain/groupActivity.ts';
import { appendGroupActivityPage } from '../src/domain/groupActivityPagination.ts';
import { listGroupActivity } from '../src/data/remoteGroupActivity.ts';

const baseRow = {
  id: 'a2ec45d4-3560-4c2b-8d46-6ef06b9952aa',
  group_id: '776c7b43-f3dd-43c5-88cd-975ba7723a96',
  trip_client_id: 'trip-safe-id',
  created_at: '2026-10-25T00:00:00.000Z',
  actor_display_name: 'Mina',
};

test('maps only supported trip sync actions into the public event contract', () => {
  const event = toGroupActivityEvent({ ...baseRow, action: 'expense.create', expense_title: '점심', expense_amount_krw: 12500 });
  assert.deepEqual(event, {
    id: baseRow.id,
    type: 'expense_added',
    occurredAt: baseRow.created_at,
    groupId: baseRow.group_id,
    tripId: baseRow.trip_client_id,
    actor: { displayName: 'Mina' },
    expense: { title: '점심', amountKrw: 12500 },
  });
  assert.equal(JSON.stringify(event).includes('actor_user_id'), false);
});

test('omits unknown actions and does not identify an inactive actor', () => {
  assert.equal(toGroupActivityEvent({ ...baseRow, action: 'expense.private_payload' }), null);
  const event = toGroupActivityEvent({ ...baseRow, actor_display_name: null, action: 'photo.delete' });
  assert.equal(event?.actor, null);
  assert.equal(event?.expense, null);
});

test('includes only complete, positive safe-integer KRW details for expense creation', () => {
  const event = (title, amount, action = 'expense.create') => toGroupActivityEvent({
    ...baseRow, action, expense_title: title, expense_amount_krw: amount,
  });
  assert.deepEqual(event('  택시  ', '9000').expense, { title: '택시', amountKrw: 9000 });
  for (const amount of [null, undefined, 0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1, '9000.0', '9007199254740992', '']) {
    assert.equal(event('택시', amount).expense, null);
  }
  assert.equal(event(null, 9000).expense, null);
  assert.equal(event('택시', 9000, 'expense.update').expense, null);
});

test('appends cursor pages once by event id', () => {
  const event = (id) => ({ ...toGroupActivityEvent({ ...baseRow, id, action: 'expense.create' }), id });
  assert.deepEqual(
    appendGroupActivityPage([event('a'), event('b')], [event('b'), event('c'), event('c')]).map(({ id }) => id),
    ['a', 'b', 'c'],
  );
});

test('calls the scoped RPC with a five-row cap and forwards its opaque keyset cursor', async () => {
  let receivedName;
  let receivedArgs;
  const rpc = async (name, args) => {
    receivedName = name;
    receivedArgs = args;
    return { data: [{ ...baseRow, action: 'expense.create', expense_title: '점심', expense_amount_krw: 12000, next_cursor: 'opaque-next' }], error: null };
  };
  const page = await listGroupActivity(baseRow.group_id, { tripId: baseRow.trip_client_id, limit: 99, cursor: 'opaque-prev' }, { rpc });
  assert.equal(receivedName, 'list_group_trip_activity');
  assert.deepEqual(receivedArgs, {
    requested_group_id: baseRow.group_id,
    requested_trip_id: baseRow.trip_client_id,
    requested_limit: 5,
    requested_cursor: 'opaque-prev',
  });
  assert.equal(page.events[0].expense.amountKrw, 12000);
  assert.equal(page.nextCursor, 'opaque-next');
});

test('trip id validation rejects unsupported characters', async () => {
  await assert.rejects(listGroupActivity(baseRow.group_id, { tripId: 'bad/trip' }, { rpc: async () => ({ data: [], error: null }) }), /Invalid trip ID/);
});

test('treats omitted details as absent and rejects a malformed RPC response', async () => {
  const noDetails = await listGroupActivity(baseRow.group_id, { tripId: baseRow.trip_client_id }, {
    rpc: async () => ({ data: [{ ...baseRow, action: 'expense.create' }], error: null }),
  });
  assert.equal(noDetails.events[0].expense, null);
  await assert.rejects(listGroupActivity(baseRow.group_id, { tripId: baseRow.trip_client_id }, {
    rpc: async () => ({ data: null, error: null }),
  }), /Invalid group activity response/);
});
