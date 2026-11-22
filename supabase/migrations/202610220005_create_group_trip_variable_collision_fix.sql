-- Resolve PL/pgSQL variable/column ambiguity in the idempotency lookup.
-- This replaces only the function body; the RPC signature and client contract stay fixed.

create or replace function public.create_group_trip(requested_group_id uuid, requested_trip jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  current_user_id uuid := auth.uid();
  target_group public.groups%rowtype;
  creator_member public.group_members%rowtype;
  creator_client_member_id text;
  v_trip_client_id text;
  trip_name text;
  date_parts text[];
  trip_start_date date;
  trip_end_date date;
  trips jsonb;
  updated_snapshot jsonb;
  existing_trip jsonb;
  existing_count integer;
  existing_key public.group_trip_creation_keys%rowtype;
  accepted_trip jsonb;
  group_client_id text;
  recipient record;
begin
  if current_user_id is null then raise exception 'authentication_required'; end if;
  if requested_group_id is null
     or jsonb_typeof(requested_trip) is distinct from 'object'
     or octet_length(requested_trip::text) > 100000 then
    raise exception 'invalid_group_trip';
  end if;

  -- Lifecycle timestamps and any unrecognized field are server controlled.
  if requested_trip ?| array['startedAt', 'endedAt', 'settledAt', 'createdAt', 'createdByUserId']
     or requested_trip - array['id', 'name', 'destination', 'detailAddress', 'dateRange', 'treasurerId', 'expenses']::text[] <> '{}'::jsonb
     or jsonb_typeof(requested_trip -> 'expenses') is distinct from 'array'
     or jsonb_array_length(requested_trip -> 'expenses') <> 0 then
    raise exception 'invalid_group_trip';
  end if;

  v_trip_client_id := requested_trip ->> 'id';
  trip_name := requested_trip ->> 'name';
  if v_trip_client_id is null or v_trip_client_id <> btrim(v_trip_client_id)
     or jsonb_typeof(requested_trip -> 'id') is distinct from 'string'
     or length(v_trip_client_id) not between 1 and 128
     or jsonb_typeof(requested_trip -> 'name') is distinct from 'string'
     or trip_name is null or trip_name <> btrim(trip_name)
     or length(trip_name) not between 1 and 120
     or jsonb_typeof(requested_trip -> 'destination') is distinct from 'string'
     or requested_trip ->> 'destination' is null
     or length(requested_trip ->> 'destination') > 240
     or jsonb_typeof(requested_trip -> 'detailAddress') is distinct from 'string'
     or requested_trip ->> 'detailAddress' is null
     or length(requested_trip ->> 'detailAddress') > 500
     or jsonb_typeof(requested_trip -> 'treasurerId') is distinct from 'string'
     or requested_trip ->> 'treasurerId' is null
     or length(requested_trip ->> 'treasurerId') not between 1 and 128 then
    raise exception 'invalid_group_trip';
  end if;

  if jsonb_typeof(requested_trip -> 'dateRange') is distinct from 'string' then
    raise exception 'invalid_group_trip_date_range';
  end if;
  date_parts := regexp_match(requested_trip ->> 'dateRange',
    '^\s*([0-9]{4})\.\s*([0-9]{1,2})\.\s*([0-9]{1,2})\.\s*-\s*([0-9]{4})\.\s*([0-9]{1,2})\.\s*([0-9]{1,2})\.\s*$');
  if date_parts is null then raise exception 'invalid_group_trip_date_range'; end if;
  begin
    trip_start_date := make_date(date_parts[1]::integer, date_parts[2]::integer, date_parts[3]::integer);
    trip_end_date := make_date(date_parts[4]::integer, date_parts[5]::integer, date_parts[6]::integer);
  exception when others then
    raise exception 'invalid_group_trip_date_range';
  end;
  if trip_end_date < trip_start_date then raise exception 'invalid_group_trip_date_range'; end if;

  -- Serializes competing trip creation and the snapshot read/modify/write.
  select g.* into target_group
  from public.groups g
  where g.id = requested_group_id
  for update;
  if target_group.id is null then raise exception 'group_trip_not_found_or_not_member'; end if;

  select gm.* into creator_member
  from public.group_members gm
  where gm.group_id = target_group.id and gm.user_id = current_user_id and gm.status = 'active'
  for update;
  if creator_member.id is null then raise exception 'group_trip_not_found_or_not_member'; end if;
  creator_client_member_id := coalesce(creator_member.client_member_id, creator_member.id::text);

  if exists (
    select 1
    from public.groups other_group
    cross join lateral jsonb_array_elements(
      case
        when jsonb_typeof(other_group.client_snapshot #> '{group,trips}') = 'array'
          then other_group.client_snapshot #> '{group,trips}'
        else '[]'::jsonb
      end
    ) other_trip(value)
    where other_group.id <> target_group.id and other_trip.value ->> 'id' = v_trip_client_id
  ) then
    raise exception 'group_trip_id_conflict';
  end if;

  if jsonb_typeof(target_group.client_snapshot #> '{group,trips}') is distinct from 'array'
     or jsonb_typeof(target_group.client_snapshot #> '{group,members}') is distinct from 'array'
     or target_group.client_snapshot #>> '{group,id}' is distinct from coalesce(target_group.client_group_id, target_group.id::text)
     or not exists (
       select 1 from jsonb_array_elements(target_group.client_snapshot #> '{group,members}') member_item
       where member_item.value ->> 'id' = requested_trip ->> 'treasurerId'
     ) then
    raise exception 'group_trip_not_found_or_not_member';
  end if;

  trips := target_group.client_snapshot #> '{group,trips}';
  select count(*), (array_agg(item.value))[1]
    into existing_count, existing_trip
  from jsonb_array_elements(trips) item(value)
  where item.value ->> 'id' = v_trip_client_id;
  if existing_count > 1 then raise exception 'group_trip_id_conflict'; end if;

  select k.* into existing_key
  from public.group_trip_creation_keys k
  where k.group_id = target_group.id and k.trip_client_id = v_trip_client_id;

  if existing_key.group_id is not null then
    if existing_key.created_by_user_id is distinct from current_user_id
       or existing_key.request_payload <> requested_trip
       or existing_count <> 1 then
      raise exception 'group_trip_id_conflict';
    end if;
    return jsonb_build_object(
      'groupId', coalesce(target_group.client_group_id, target_group.id::text),
      'groupDbId', target_group.id::text,
      'tripId', v_trip_client_id,
      'tripName', existing_trip ->> 'name',
      'created', false
    );
  end if;
  if existing_count > 0 then raise exception 'group_trip_id_conflict'; end if;

  -- Lock account memberships while choosing recipients so inactive/unlinked rows
  -- cannot race into this event. The creator receives no self-notification.
  perform gm.id
  from public.group_members gm
  where gm.group_id = target_group.id and gm.status = 'active' and gm.user_id is not null
  order by gm.id
  for update;

  accepted_trip := requested_trip - 'startedAt' - 'endedAt' - 'settledAt';
  updated_snapshot := jsonb_set(
    target_group.client_snapshot,
    '{group,trips}',
    trips || jsonb_build_array(accepted_trip),
    false
  );
  if octet_length(updated_snapshot::text) > 1000000 then
    raise exception 'invalid_group_snapshot';
  end if;

  update public.groups g
  set client_snapshot = updated_snapshot,
      updated_at = clock_timestamp()
  where g.id = target_group.id;

  insert into public.group_trip_creation_keys(
    group_id, trip_client_id, created_by_user_id, request_payload
  ) values (target_group.id, v_trip_client_id, current_user_id, requested_trip);

  group_client_id := coalesce(target_group.client_group_id, target_group.id::text);
  for recipient in
    select gm.user_id, gm.client_member_id, gm.display_name
    from public.group_members gm
    where gm.group_id = target_group.id
      and gm.status = 'active' and gm.user_id is not null and gm.user_id <> current_user_id
    order by gm.id
  loop
    insert into public.group_notifications(
      recipient_user_id, group_id, group_client_id, group_name,
      member_client_id, member_name, notification_type, trip_client_id, trip_name
    ) values (
      recipient.user_id, target_group.id, group_client_id, target_group.name,
      creator_client_member_id, creator_member.display_name, 'trip_created', v_trip_client_id, trip_name
    );
  end loop;

  return jsonb_build_object(
    'groupId', group_client_id,
    'groupDbId', target_group.id::text,
    'tripId', v_trip_client_id,
    'tripName', trip_name,
    'created', true
  );
end;
$$;


revoke all on function public.create_group_trip(uuid, jsonb) from public, anon;
grant execute on function public.create_group_trip(uuid, jsonb) to authenticated;

comment on function public.create_group_trip(uuid, jsonb) is
  'Atomically appends one validated app trip to an authenticated active member group snapshot and creates recipient-only trip_created notifications for other active account members. requested_group_id is groups.id; retrying the same request by its creator returns created=false without changing the snapshot or notifications.';

notify pgrst, 'reload schema';
