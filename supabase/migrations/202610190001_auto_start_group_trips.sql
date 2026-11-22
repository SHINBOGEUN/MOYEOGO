-- Start trips in the shared group snapshot at the Asia/Seoul start-date boundary.
-- The snapshot is the app's source of truth; public.trips is a separate relational model.

alter table public.group_notifications
  drop constraint if exists group_notifications_notification_type_check;
alter table public.group_notifications
  add constraint group_notifications_notification_type_check
  check (notification_type in ('member_left', 'group_invitation', 'invitation_accepted', 'trip_started'));

alter table public.group_notifications
  add column if not exists trip_client_id text,
  add column if not exists trip_name text,
  add column if not exists started_at timestamptz;

create unique index if not exists group_notifications_one_trip_started_per_recipient
  on public.group_notifications(recipient_user_id, group_id, trip_client_id)
  where notification_type = 'trip_started' and trip_client_id is not null;

-- A stale owner snapshot must not erase the server-set lifecycle timestamp.
create or replace function public.preserve_group_trip_started_at()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  old_trip jsonb;
  merged_trips jsonb := '[]'::jsonb;
  incoming_trip jsonb;
  incoming_id text;
  preserved_started_at jsonb;
begin
  if old.client_snapshot is null or new.client_snapshot is null
     or jsonb_typeof(old.client_snapshot #> '{group,trips}') <> 'array'
     or jsonb_typeof(new.client_snapshot #> '{group,trips}') <> 'array' then
    return new;
  end if;

  for incoming_trip in
    select value from jsonb_array_elements(new.client_snapshot #> '{group,trips}')
  loop
    incoming_id := incoming_trip ->> 'id';
    select prior.value into old_trip
    from jsonb_array_elements(old.client_snapshot #> '{group,trips}') prior(value)
    where prior.value ->> 'id' = incoming_id
      and nullif(prior.value ->> 'startedAt', '') is not null
    limit 1;

    if old_trip is not null and nullif(incoming_trip ->> 'startedAt', '') is null then
      preserved_started_at := old_trip -> 'startedAt';
      incoming_trip := jsonb_set(incoming_trip, '{startedAt}', preserved_started_at, true);
    end if;
    merged_trips := merged_trips || jsonb_build_array(incoming_trip);
    old_trip := null;
  end loop;

  new.client_snapshot := jsonb_set(new.client_snapshot, '{group,trips}', merged_trips, false);
  return new;
end;
$$;

revoke all on function public.preserve_group_trip_started_at() from public, anon, authenticated;
drop trigger if exists groups_preserve_trip_started_at on public.groups;
create trigger groups_preserve_trip_started_at
  before update of client_snapshot on public.groups
  for each row execute function public.preserve_group_trip_started_at();

-- Server-only, safe to run repeatedly. Each group row lock serializes concurrent runs
-- with one another and with save_group_snapshot; the unique index is a second dedupe guard.
create or replace function public.start_due_group_trips()
returns integer language plpgsql security definer set search_path = '' as $$
declare
  group_row public.groups%rowtype;
  trip_item jsonb;
  date_parts text[];
  trip_start_date date;
  trip_client_id text;
  trip_name text;
  start_timestamp timestamptz := clock_timestamp();
  seoul_today date := (clock_timestamp() at time zone 'Asia/Seoul')::date;
  started_count integer := 0;
  active_member record;
  updated_trips jsonb;
  group_changed boolean;
begin
  for group_row in
    select g.* from public.groups g
    where g.client_snapshot is not null
      and jsonb_typeof(g.client_snapshot #> '{group,trips}') = 'array'
    order by g.id
    for update
  loop
    updated_trips := '[]'::jsonb;
    group_changed := false;
    for trip_item in
      select value from jsonb_array_elements(group_row.client_snapshot #> '{group,trips}')
    loop
      trip_client_id := nullif(trip_item ->> 'id', '');
      trip_name := coalesce(trip_item ->> 'name', '');
      date_parts := regexp_match(coalesce(trip_item ->> 'dateRange', ''),
        '([0-9]{4})\.\s*([0-9]{1,2})\.\s*([0-9]{1,2})\.');
      trip_start_date := null;

      if date_parts is not null then
        begin
          trip_start_date := make_date(date_parts[1]::integer, date_parts[2]::integer, date_parts[3]::integer);
        exception when others then
          trip_start_date := null;
        end;
      end if;

      if trip_client_id is not null
         and trip_start_date is not null and trip_start_date <= seoul_today
         and nullif(trip_item ->> 'startedAt', '') is null
         and nullif(trip_item ->> 'endedAt', '') is null
         and nullif(trip_item ->> 'settledAt', '') is null then
        trip_item := jsonb_set(trip_item, '{startedAt}', to_jsonb(start_timestamp::text), true);
        started_count := started_count + 1;
        group_changed := true;

        for active_member in
          select gm.user_id, gm.client_member_id, gm.display_name
          from public.group_members gm
          where gm.group_id = group_row.id and gm.status = 'active' and gm.user_id is not null
        loop
          insert into public.group_notifications(
            recipient_user_id, group_id, group_client_id, group_name,
            member_client_id, member_name, notification_type,
            trip_client_id, trip_name, started_at
          ) values (
            active_member.user_id, group_row.id,
            coalesce(group_row.client_group_id, group_row.id::text), group_row.name,
            coalesce(trip_client_id, active_member.client_member_id, active_member.user_id::text),
            trip_name, 'trip_started', trip_client_id, trip_name, start_timestamp
          )
          on conflict (recipient_user_id, group_id, trip_client_id)
            where notification_type = 'trip_started' and trip_client_id is not null
            do nothing;
        end loop;
      end if;
      updated_trips := updated_trips || jsonb_build_array(trip_item);
    end loop;

    if group_changed then
      update public.groups
      set client_snapshot = jsonb_set(client_snapshot, '{group,trips}', updated_trips, false),
          updated_at = start_timestamp
      where id = group_row.id;
    end if;
  end loop;
  return started_count;
end;
$$;

revoke all on function public.start_due_group_trips() from public, anon, authenticated;
grant execute on function public.start_due_group_trips() to service_role;

-- Extend the established authenticated recipient-only API with trip event details.
create or replace function public.list_my_group_notifications()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare current_user_id uuid := auth.uid(); result jsonb;
begin
  if current_user_id is null then raise exception 'authentication_required'; end if;
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', n.id,
    'type', n.notification_type,
    'groupId', n.group_client_id,
    'groupName', n.group_name,
    'memberId', n.member_client_id,
    'memberName', n.member_name,
    'invitationId', n.invitation_id,
    'tripId', n.trip_client_id,
    'tripName', n.trip_name,
    'startedAt', n.started_at,
    'createdAt', n.created_at,
    'readAt', n.read_at
  ) order by n.created_at desc), '[]'::jsonb) into result
  from public.group_notifications n
  where n.recipient_user_id = current_user_id
    and (n.notification_type <> 'group_invitation' or exists (
      select 1 from public.group_member_invitations i
      join public.group_members gm on gm.id = i.group_member_id and gm.group_id = i.group_id
      where i.id = n.invitation_id and i.invited_user_id = current_user_id and i.status = 'pending'
        and gm.invited_user_id = current_user_id and gm.status = 'pending'
    ));
  return result;
end;
$$;

revoke all on function public.list_my_group_notifications() from public, anon;
grant execute on function public.list_my_group_notifications() to authenticated;

comment on function public.start_due_group_trips() is
  'Starts due trips in shared group snapshots using Asia/Seoul calendar dates and records one in-app event per active account member. Server scheduler must invoke this service-role-only function.';
comment on function public.list_my_group_notifications() is
  'Returns only notifications addressed to auth.uid(); trip_started notices include tripId, tripName, and startedAt.';
comment on column public.group_notifications.trip_client_id is
  'App trip ID from the shared group snapshot; used to deduplicate trip_started events per recipient.';

notify pgrst, 'reload schema';
