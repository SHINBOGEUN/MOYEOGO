import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { listGroupExpenseAudit } from '../src/data/remoteGroupExpenseAudit.ts';

const migration = readFileSync(new URL('../supabase/migrations/202610250002_group_expense_audit_read_api.sql', import.meta.url), 'utf8');
const baseRow = {
  event_key: '0123456789abcdef0123456789abcdef',
  action: 'expense.update',
  occurred_at: '2026-10-25T00:00:00.000Z',
  actor_display_name: 'Mina',
  before_title: 'Lunch', before_amount_krw: 12000, before_participant_count: 2, before_total_amount_krw: 12000,
  after_title: 'Dinner', after_amount_krw: 18000, after_participant_count: 3, after_total_amount_krw: 18000,
  next_cursor: 'Y3Vyc29y',
};

test('maps a separate allowlisted expense history DTO and bounds the RPC request', async () => {
  let request;
  const client = { rpc: async (name, args) => { request = { name, args }; return { data: [baseRow], error: null }; } };
  const page = await listGroupExpenseAudit('776c7b43-f3dd-43c5-88cd-975ba7723a96', 'trip-1', {
    limit: 1000, cursor: 'Y3Vyc29y',
  }, client);

  assert.equal(request.name, 'list_group_expense_audit');
  assert.equal(request.args.requested_limit, 50);
  assert.equal(request.args.requested_cursor, 'Y3Vyc29y');
  assert.deepEqual(page, {
    items: [{
      eventKey: baseRow.event_key,
      action: 'expense.update',
      occurredAt: baseRow.occurred_at,
      actorDisplayName: 'Mina',
      before: { title: 'Lunch', amountKrw: 12000, split: { participantCount: 2, totalAmountKrw: 12000 } },
      after: { title: 'Dinner', amountKrw: 18000, split: { participantCount: 3, totalAmountKrw: 18000 } },
    }],
    nextCursor: 'Y3Vyc29y',
  });
  const serialized = JSON.stringify(page);
  assert.doesNotMatch(serialized, /actor_user_id|expense_client_id|participantIds|raw json|private-auth-id/);
});

test('rejects malformed identifiers, cursors, and unexpected action rows', async () => {
  const client = { rpc: async () => ({ data: [{ ...baseRow, action: 'expense.other' }], error: null }) };
  await assert.rejects(() => listGroupExpenseAudit('bad', 'trip-1', {}, client), /Invalid group or trip ID/);
  await assert.rejects(() => listGroupExpenseAudit('776c7b43-f3dd-43c5-88cd-975ba7723a96', 'trip-1', { cursor: 'bad!' }, client), /Invalid expense history cursor/);
  await assert.rejects(() => listGroupExpenseAudit('776c7b43-f3dd-43c5-88cd-975ba7723a96', 'trip-1', {}, client), /Invalid expense audit response/);
});

test('RPC migration keeps details private and enforces active membership and trip scope', () => {
  assert.match(migration, /security definer set search_path = ''/);
  assert.match(migration, /m\.user_id = current_user_id[\s\S]*?m\.status = 'active'/);
  assert.match(migration, /trip\.value ->> 'id' = requested_trip_id/);
  assert.match(migration, /grant execute on function public\.list_group_expense_audit[\s\S]*?to authenticated/);
  assert.match(migration, /group_id = requested_group_id[\s\S]*?trip_client_id = requested_trip_id/);
  assert.match(migration, /m\.user_id = p\.actor_user_id and m\.status = 'active'/);
  assert.match(migration, /md5\(p\.id::text\)/);
  assert.doesNotMatch(migration, /grant select[^;]*group_sync_event_audit/i);
  assert.match(migration, /create index group_sync_events_group_trip_created_id/);
});
