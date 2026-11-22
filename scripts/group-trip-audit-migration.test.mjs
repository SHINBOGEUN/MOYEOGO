import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';

const migration = readFileSync(new URL('../supabase/migrations/202610250001_group_trip_change_audit.sql', import.meta.url), 'utf8');
const activityApi = readFileSync(new URL('../src/data/remoteGroupActivity.ts', import.meta.url), 'utf8');

test('private audit details are inaccessible to app roles and retain expense before/after values', () => {
  assert.match(migration, /create table public\.group_sync_event_audit/);
  assert.match(migration, /alter table public\.group_sync_event_audit enable row level security/);
  assert.match(migration, /revoke all on public\.group_sync_event_audit from public, anon, authenticated/);
  assert.match(migration, /revoke insert, update, delete, truncate on public\.group_sync_events from public, anon, authenticated/);
  assert.match(migration, /'title',old\.title,'amount',old\.amount_krw,'payerId',old\.payer_member_client_id/);
  assert.match(migration, /'participantIds',old\.participant_member_client_ids/);
  assert.match(migration, /'title',new\.title,'amount',new\.amount_krw,'payerId',new\.payer_member_client_id/);
  assert.match(migration, /'participantIds',new\.participant_member_client_ids/);
  assert.match(migration, /nullif\(detail -> 'before','null'::jsonb\)/);
});

test('audit is appended by the matching event trigger and remains outside the activity API', () => {
  assert.match(migration, /after insert on public\.group_sync_events/);
  assert.match(migration, /detail ->> 'actorUserId' is distinct from new\.actor_user_id::text/);
  assert.match(migration, /detail ->> 'action' is distinct from new\.action/);
  assert.match(migration, /insert into public\.group_sync_event_audit\(event_id,actor_user_id,action,occurred_at,before_state,after_state\)/);
  assert.doesNotMatch(activityApi, /group_sync_event_audit|before_state|after_state/);
  assert.match(activityApi, /select\('id,group_id,trip_client_id,action,actor_user_id,created_at'\)/);
});
