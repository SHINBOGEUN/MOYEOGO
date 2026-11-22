import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const sql = readFileSync(new URL('../supabase/migrations/202610250003_group_trip_activity_details.sql', import.meta.url), 'utf8');

test('activity detail RPC is scoped, five-row paginated, and joins audit by exact event key', () => {
  assert.match(sql, /a\.event_id\s*=\s*e\.id/);
  assert.match(sql, /a\.action\s*=\s*e\.action/);
  assert.match(sql, /m\.status\s*=\s*'active'/);
  assert.match(sql, /trip\.value\s*->>\s*'id'\s*=\s*requested_trip_id/);
  assert.match(sql, /e\.group_id\s*=\s*requested_group_id/);
  assert.match(sql, /e\.trip_client_id\s*=\s*requested_trip_id/);
  assert.match(sql, /least\(greatest\(coalesce\(requested_limit, 5\), 1\), 5\)/);
  assert.match(sql, /order by e\.created_at desc, e\.id desc/);
  assert.match(sql, /\(e\.created_at, e\.id\) < \(cursor_time, cursor_event_id\)/);
});

test('only create events project title and amount, with no entity ID or raw audit state', () => {
  assert.match(sql, /case when p\.action = 'expense\.create' then p\.after_state ->> 'title' end/);
  assert.match(sql, /case when p\.action = 'expense\.create' then \(p\.after_state ->> 'amount'\)::bigint end/);
  assert.match(sql, /returns table\s*\([\s\S]*?expense_title text,[\s\S]*?expense_amount_krw bigint,[\s\S]*?next_cursor text\s*\)/);
  assert.doesNotMatch(sql, /entity_client_id|actor_user_id,\s*expense_title|after_state jsonb/);
  assert.match(sql, /grant execute on function public\.list_group_trip_activity\(uuid, text, integer, text\) to authenticated/);
  assert.match(sql, /revoke all on function public\.list_group_trip_activity\(uuid, text, integer, text\) from public, anon/);
});
