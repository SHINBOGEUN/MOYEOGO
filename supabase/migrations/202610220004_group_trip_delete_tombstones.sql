-- Persist deleted trip IDs so a stale owner snapshot cannot recreate a trip.
-- Tombstones are private implementation state; clients access them only through
-- the owner-only delete RPC and the snapshot filtering trigger below.
create table public.group_trip_delete_tombstones (
  group_id uuid not null references public.groups(id) on delete cascade,
  trip_id text not null,
  primary key (group_id, trip_id)
);

alter table public.group_trip_delete_tombstones enable row level security;
revoke all on table public.group_trip_delete_tombstones from public, anon, authenticated;

create or replace function public.filter_deleted_group_trips()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  trips jsonb;
begin
  if new.client_snapshot is null
     or jsonb_typeof(new.client_snapshot #> '{group,trips}') is distinct from 'array' then
    return new;
  end if;

  select coalesce(jsonb_agg(item.value order by item.ordinality), '[]'::jsonb)
    into trips
  from jsonb_array_elements(new.client_snapshot #> '{group,trips}')
       with ordinality as item(value, ordinality)
  where not exists (
    select 1
    from public.group_trip_delete_tombstones tombstone
    where tombstone.group_id = new.id
      and tombstone.trip_id = item.value ->> 'id'
  );

  new.client_snapshot := jsonb_set(new.client_snapshot, '{group,trips}', trips, false);
  return new;
end;
$$;

revoke all on function public.filter_deleted_group_trips() from public, anon, authenticated;

create trigger groups_filter_deleted_trips
before insert or update of client_snapshot on public.groups
for each row execute function public.filter_deleted_group_trips();

create or replace function public.delete_group_trip(
  requested_group_id uuid,
  requested_trip_id text
) returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := auth.uid();
  target_group public.groups%rowtype;
  trips jsonb;
  trip_item jsonb;
  target_trip jsonb;
  retained_trips jsonb := '[]'::jsonb;
  matched_count integer := 0;
begin
  if current_user_id is null then
    raise exception using errcode = '42501', message = 'GROUP_TRIP_NOT_FOUND_OR_FORBIDDEN';
  end if;

  select g.* into target_group
  from public.groups g
  where g.id = requested_group_id
    and g.owner_user_id = current_user_id
  for update;

  if target_group.id is null
     or requested_trip_id is null
     or requested_trip_id = ''
     or jsonb_typeof(target_group.client_snapshot #> '{group,trips}') is distinct from 'array' then
    raise exception using errcode = '42501', message = 'GROUP_TRIP_NOT_FOUND_OR_FORBIDDEN';
  end if;

  trips := target_group.client_snapshot #> '{group,trips}';
  select count(*)::integer, (array_agg(item.value))[1]
    into matched_count, target_trip
  from jsonb_array_elements(trips) item(value)
  where item.value ->> 'id' = requested_trip_id;

  if matched_count <> 1 then
    raise exception using errcode = '42501', message = 'GROUP_TRIP_NOT_FOUND_OR_FORBIDDEN';
  end if;

  if nullif(btrim(target_trip ->> 'settledAt'), '') is not null then
    raise exception using errcode = 'P1002', message = 'GROUP_TRIP_ALREADY_SETTLED';
  end if;

  -- Deletion is allowed only when expenses is explicitly a JSON array.
  -- Missing, JSON null, and every other shape fail closed.
  if not (target_trip ? 'expenses')
     or jsonb_typeof(target_trip -> 'expenses') is distinct from 'array' then
    raise exception using errcode = 'P1003', message = 'GROUP_TRIP_EXPENSES_UNVERIFIABLE';
  end if;
  if jsonb_array_length(target_trip -> 'expenses') > 0 then
    raise exception using errcode = 'P1001', message = 'GROUP_TRIP_HAS_EXPENSES';
  end if;

  -- The group lock serializes deletion with save_group_snapshot's upsert. The
  -- tombstone is committed atomically with removal from the current snapshot.
  insert into public.group_trip_delete_tombstones(group_id, trip_id)
  values (target_group.id, requested_trip_id)
  on conflict (group_id, trip_id) do nothing;

  for trip_item in select value from jsonb_array_elements(trips)
  loop
    if trip_item ->> 'id' is distinct from requested_trip_id then
      retained_trips := retained_trips || jsonb_build_array(trip_item);
    end if;
  end loop;

  update public.groups g
  set client_snapshot = jsonb_set(
    target_group.client_snapshot,
    '{group,trips}',
    retained_trips,
    false
  )
  where g.id = target_group.id
    and g.owner_user_id = current_user_id;

  if not found then
    raise exception using errcode = '42501', message = 'GROUP_TRIP_NOT_FOUND_OR_FORBIDDEN';
  end if;

  return true;
end;
$$;

revoke all on function public.delete_group_trip(uuid, text) from public, anon;
grant execute on function public.delete_group_trip(uuid, text) to authenticated;

comment on table public.group_trip_delete_tombstones is
  'Private deletion markers preventing stale group snapshots from restoring app trips.';
comment on function public.delete_group_trip(uuid, text) is
  'Owner-only atomic deletion with a private tombstone. Requires an explicitly present empty expenses array and refuses settled trips.';

notify pgrst, 'reload schema';
