import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';

const migration = readFileSync(new URL('../supabase/migrations/202610240001_group_trip_sync_commands.sql', import.meta.url), 'utf8');
const photoDeleteBranch = migration.split("elsif requested_action = 'photo.delete' then")[1]
  ?.split("elsif requested_action like 'expense.%' then")[0];

test('photo.delete locks only live rows and authorizes only live rows before mutation', () => {
  assert.ok(photoDeleteBranch, 'photo.delete branch exists');
  assert.match(photoDeleteBranch, /select p\.version into ver[\s\S]*?p\.deleted_at is null for update;/);
  assert.match(photoDeleteBranch, /if not exists \(select 1[\s\S]*?p\.deleted_at is null[\s\S]*?p\.added_by_user_id=uid/);
  assert.match(photoDeleteBranch, /update public\.group_trip_sync_photos p set deleted_at=now\(\)[\s\S]*?and p\.deleted_at is null;/);
});
