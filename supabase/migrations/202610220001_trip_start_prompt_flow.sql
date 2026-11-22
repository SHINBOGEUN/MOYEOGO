-- Replace date-based automatic trip starts with recipient-scoped start prompts.
-- The app passes groups.id as requested_group_id and the snapshot's text trip ID.

alter table public.group_notifications
  drop constraint if exists group_notifications_notification_type_check;
alter table public.group_notifications
  add constraint group_notifications_notification_type_check
  check (notification_type in (
    'member_left', 'group_invitation', 'invitation_accepted', 'trip_started', 'trip_start_prompt'
  ));

create unique index if not exists group_notifications_one_trip_start_prompt_per_recipient
  on public.group_notifications(recipient_user_id, group_id, trip_client_id)
  where notification_type = 'trip_start_prompt' and trip_client_id is not null;

-- Preserve server-set timestamps against stale owner snapshots, and prevent clients
-- from starting a trip by writing startedAt through save_group_snapshot.
create or replace function public.preserve_group_trip_started_at()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  old_trip jsonb;
  merged_trips jsonb := '[]'::jsonb;
  incoming_trip jsonb;
  incoming_id text;
  prior_started_at jsonb;
  server_start_allowed boolean := coalesce(current_setting('moyeogo.server_trip_start', true), '') = 'on';
begin
  if new.client_snapshot is null
     or jsonb_typeof(new.client_snapshot #> '{group,trips}') is distinct from 'array' then
    return new;
  end if;

  if tg_op = 'INSERT' then
    if not server_start_allowed then
      for incoming_trip in
        select value from jsonb_array_elements(new.client_snapshot #> '{group,trips}')
      loop
        merged_trips := merged_trips || jsonb_build_array(incoming_trip - 'startedAt');
      end loop;
      new.client_snapshot := jsonb_set(new.client_snapshot, '{group,trips}', merged_trips, false);
    end if;
    return new;
  end if;
  if old.client_snapshot is null
     or jsonb_typeof(old.client_snapshot #> '{group,trips}') is distinct from 'array' then
    return new;
  end if;

  for incoming_trip in
    select value from jsonb_array_elements(new.client_snapshot #> '{group,trips}')
  loop
    incoming_id := incoming_trip ->> 'id';
    select prior.value into old_trip
    from jsonb_array_elements(old.client_snapshot #> '{group,trips}') prior(value)
    where prior.value ->> 'id' = incoming_id
    limit 1;

    prior_started_at := old_trip -> 'startedAt';
    if server_start_allowed then
      null;
    elsif nullif(prior_started_at #>> '{}', '') is not null then
      incoming_trip := jsonb_set(incoming_trip, '{startedAt}', prior_started_at, true);
    else
      incoming_trip := incoming_trip - 'startedAt';
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
  before insert or update on public.groups
  for each row execute function public.preserve_group_trip_started_at();

-- If the previous migration already auto-started an otherwise still-open trip,
-- undo only timestamps that exactly match its generated trip_started event and
-- turn current active members' event rows into fresh, unread prompts.
do $$
declare
  group_row public.groups%rowtype;
  trip_item jsonb;
  updated_trips jsonb;
  legacy_started_at timestamptz;
begin
  for group_row in
    select g.* from public.groups g
    where g.client_snapshot is not null
      and jsonb_typeof(g.client_snapshot #> '{group,trips}') = 'array'
      and exists (
        select 1 from public.group_notifications n
        where n.group_id = g.id and n.notification_type = 'trip_started'
          and n.trip_client_id is not null and n.started_at is not null
      )
    order by g.id
    for update
  loop
    updated_trips := '[]'::jsonb;
    for trip_item in
      select value from jsonb_array_elements(group_row.client_snapshot #> '{group,trips}')
    loop
      legacy_started_at := null;
      if nullif(trip_item ->> 'startedAt', '') is not null
         and nullif(trip_item ->> 'endedAt', '') is null
         and nullif(trip_item ->> 'settledAt', '') is null then
        begin
          select n.started_at into legacy_started_at
          from public.group_notifications n
          where n.group_id = group_row.id and n.trip_client_id = trip_item ->> 'id'
            and n.notification_type = 'trip_started'
            and n.started_at = (trip_item ->> 'startedAt')::timestamptz
          limit 1;
        exception when others then
          legacy_started_at := null;
        end;
      end if;
      if legacy_started_at is not null then
        trip_item := trip_item - 'startedAt';
        update public.group_notifications n
        set notification_type = 'trip_start_prompt', started_at = null, read_at = null,
            member_client_id = coalesce(gm.client_member_id, gm.user_id::text),
            member_name = gm.display_name
        from public.group_members gm
        where n.group_id = group_row.id and n.trip_client_id = trip_item ->> 'id'
          and n.notification_type = 'trip_started' and n.started_at = legacy_started_at
          and gm.group_id = n.group_id and gm.user_id = n.recipient_user_id and gm.status = 'active';
      end if;
      updated_trips := updated_trips || jsonb_build_array(trip_item);
    end loop;
    if updated_trips is distinct from group_row.client_snapshot #> '{group,trips}' then
      perform set_config('moyeogo.server_trip_start', 'on', true);
      update public.groups
      set client_snapshot = jsonb_set(client_snapshot, '{group,trips}', updated_trips, false)
      where id = group_row.id;
    end if;
  end loop;
end;
$$;

create or replace function public.create_due_trip_start_prompts()
returns integer language plpgsql security definer set search_path = '' as $$
declare
  group_row public.groups%rowtype;
  trip_item jsonb;
  date_parts text[];
  trip_start_date date;
  trip_client_id text;
  trip_name text;
  prompt_count integer := 0;
  active_member record;
  seoul_today date := (clock_timestamp() at time zone 'Asia/Seoul')::date;
begin
  for group_row in
    select g.* from public.groups g
    where g.client_snapshot is not null
      and jsonb_typeof(g.client_snapshot #> '{group,trips}') = 'array'
    order by g.id
    for update
  loop
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
        for active_member in
          select gm.user_id, gm.client_member_id, gm.display_name
          from public.group_members gm
          where gm.group_id = group_row.id and gm.status = 'active' and gm.user_id is not null
        loop
          insert into public.group_notifications(
            recipient_user_id, group_id, group_client_id, group_name,
            member_client_id, member_name, notification_type, trip_client_id, trip_name
          ) values (
            active_member.user_id, group_row.id,
            coalesce(group_row.client_group_id, group_row.id::text), group_row.name,
            coalesce(active_member.client_member_id, active_member.user_id::text),
            active_member.display_name, 'trip_start_prompt', trip_client_id, trip_name
          )
          on conflict (recipient_user_id, group_id, trip_client_id)
            where notification_type = 'trip_start_prompt' and trip_client_id is not null
            do nothing;
          if found then prompt_count := prompt_count + 1; end if;
        end loop;
      end if;
    end loop;
  end loop;
  return prompt_count;
end;
$$;
revoke all on function public.create_due_trip_start_prompts() from public, anon, authenticated;
grant execute on function public.create_due_trip_start_prompts() to service_role;

-- Keep an existing server schedule that calls the old entry point working, but
-- change its effect to prompt creation; it no longer mutates startedAt.
create or replace function public.start_due_group_trips()
returns integer language sql security definer set search_path = '' as $$
  select public.create_due_trip_start_prompts();
$$;
revoke all on function public.start_due_group_trips() from public, anon, authenticated;
grant execute on function public.start_due_group_trips() to service_role;

create or replace function public.start_group_trip(requested_group_id text, requested_trip_id text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  current_user_id uuid := auth.uid();
  target_group public.groups%rowtype;
  trip_item jsonb;
  updated_trips jsonb := '[]'::jsonb;
  date_parts text[];
  trip_start_date date;
  started_at timestamptz;
  matched_trip boolean := false;
  start_was_recorded boolean := false;
  seoul_today date := (clock_timestamp() at time zone 'Asia/Seoul')::date;
begin
  if current_user_id is null then raise exception 'authentication_required'; end if;

  select g.* into target_group from public.groups g
  where g.id::text = requested_group_id
  for update;
  if target_group.id is null or not exists (
    select 1 from public.group_members gm
    where gm.group_id = target_group.id and gm.user_id = current_user_id and gm.status = 'active'
  ) then
    raise exception 'group_trip_not_found_or_not_member';
  end if;
  if jsonb_typeof(target_group.client_snapshot #> '{group,trips}') is distinct from 'array' then
    raise exception 'group_trip_not_found_or_not_member';
  end if;

  for trip_item in
    select value from jsonb_array_elements(target_group.client_snapshot #> '{group,trips}')
  loop
    if trip_item ->> 'id' = requested_trip_id then
      if matched_trip then raise exception 'group_trip_not_found_or_not_member'; end if;
      matched_trip := true;
      if nullif(trip_item ->> 'startedAt', '') is not null then
        started_at := (trip_item ->> 'startedAt')::timestamptz;
        start_was_recorded := true;
      else
        if nullif(trip_item ->> 'endedAt', '') is not null
           or nullif(trip_item ->> 'settledAt', '') is not null then
          raise exception 'trip_not_startable';
        end if;
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
        if trip_start_date is null or trip_start_date > seoul_today then
          raise exception 'trip_not_startable';
        end if;
        started_at := clock_timestamp();
        trip_item := jsonb_set(trip_item, '{startedAt}',
          to_jsonb(to_char(started_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')), true);
      end if;
    end if;
    updated_trips := updated_trips || jsonb_build_array(trip_item);
  end loop;
  if not matched_trip then raise exception 'group_trip_not_found_or_not_member'; end if;

  if not start_was_recorded then
    perform set_config('moyeogo.server_trip_start', 'on', true);
    update public.groups
    set client_snapshot = jsonb_set(client_snapshot, '{group,trips}', updated_trips, false),
        updated_at = started_at
    where id = target_group.id;
  end if;

  return jsonb_build_object(
    'groupId', coalesce(target_group.client_group_id, target_group.id::text),
    'groupDbId', target_group.id::text,
    'tripId', requested_trip_id,
    'startedAt', to_char(started_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
  );
end;
$$;
revoke all on function public.start_group_trip(text, text) from public, anon;
grant execute on function public.start_group_trip(text, text) to authenticated;

create or replace function public.list_my_group_notifications()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare current_user_id uuid := auth.uid(); result jsonb;
begin
  if current_user_id is null then raise exception 'authentication_required'; end if;
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', n.id,
    'type', n.notification_type,
    'groupId', n.group_client_id,
    'groupDbId', n.group_id::text,
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
    and (n.notification_type <> 'trip_start_prompt' or exists (
      select 1
      from public.groups g
      join public.group_members gm
        on gm.group_id = g.id and gm.user_id = current_user_id and gm.status = 'active'
      cross join lateral jsonb_array_elements(
        case
          when jsonb_typeof(g.client_snapshot #> '{group,trips}') = 'array'
            then g.client_snapshot #> '{group,trips}'
          else '[]'::jsonb
        end
      ) trip(value)
      where g.id = n.group_id and trip.value ->> 'id' = n.trip_client_id
        and nullif(trip.value ->> 'startedAt', '') is null
        and nullif(trip.value ->> 'endedAt', '') is null
        and nullif(trip.value ->> 'settledAt', '') is null
    ))
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

comment on function public.create_due_trip_start_prompts() is
  'Service-role scheduler job: creates one recipient-only trip_start_prompt per active account member on/after a trip start date in Asia/Seoul; safe to retry.';
comment on function public.start_due_group_trips() is
  'Compatibility scheduler entry point. Despite its legacy name, it only creates trip_start_prompt notifications and never starts a trip.';
comment on function public.start_group_trip(text, text) is
  'Authenticated active group member starts a due trip. requested_group_id is groups.id UUID text; requested_trip_id is the app trip ID in client_snapshot. Returns {groupId, groupDbId, tripId, startedAt}; refetch list_my_group_snapshots() for the full snapshot. Repeated calls return the existing startedAt.';
comment on function public.list_my_group_notifications() is
  'Returns only notifications addressed to auth.uid(); prompts include app groupId, groupDbId for start_group_trip, tripId, and tripName.';

-- Install a 15-minute job only where pg_cron is already enabled and available.
do $$
declare
  existing_job record;
  has_active_job boolean;
begin
  if exists (select 1 from pg_catalog.pg_extension where extname = 'pg_cron')
     and to_regclass('cron.job') is not null then
    for existing_job in select jobid from cron.job where jobname = 'moyeogo-trip-start-prompts'
    loop
      perform cron.unschedule(existing_job.jobid);
    end loop;
    select exists (
      select 1 from cron.job
      where active and (
        command like '%start_due_group_trips%'
        or command like '%create_due_trip_start_prompts%'
      )
    ) into has_active_job;
    if not has_active_job then
      perform cron.schedule(
        'moyeogo-trip-start-prompts',
        '*/15 * * * *',
        'select public.create_due_trip_start_prompts();'
      );
    end if;
  end if;
end;
$$;

notify pgrst, 'reload schema';
