-- Delete exactly one app trip from a shared group snapshot.
-- Keep save_group_snapshot owner-only and never replace the full snapshot here.

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

  -- Lock before reading or changing the snapshot, and filter by owner in the
  -- lookup so missing groups and groups owned by someone else are indistinguishable.
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

  -- A settled marker takes precedence so clients can show the most relevant reason.
  if nullif(btrim(target_trip ->> 'settledAt'), '') is not null then
    raise exception using errcode = 'P1002', message = 'GROUP_TRIP_ALREADY_SETTLED';
  end if;

  if target_trip ? 'expenses' and target_trip -> 'expenses' <> 'null'::jsonb then
    if jsonb_typeof(target_trip -> 'expenses') is distinct from 'array' then
      raise exception using errcode = 'P1003', message = 'GROUP_TRIP_EXPENSES_UNVERIFIABLE';
    end if;
    if jsonb_array_length(target_trip -> 'expenses') > 0 then
      raise exception using errcode = 'P1001', message = 'GROUP_TRIP_HAS_EXPENSES';
    end if;
  end if;

  -- Preserve the order and every field of all other trip objects. The trigger
  -- that protects server-set startedAt values also runs on this targeted update.
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

comment on function public.delete_group_trip(uuid, text) is
  'Owner-only atomic deletion of one app trip from groups.client_snapshot. Refuses trips with expenses or a settledAt marker; other snapshot fields and group timestamps are preserved.';

notify pgrst, 'reload schema';
