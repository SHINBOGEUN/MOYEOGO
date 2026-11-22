-- Expose a narrowly projected, read-only view of private expense audit rows.
-- The audit table itself remains inaccessible to application roles.

create index group_sync_events_group_trip_created_id
  on public.group_sync_events(group_id, trip_client_id, created_at desc, id desc);

create or replace function public.list_group_expense_audit(
  requested_group_id uuid,
  requested_trip_id text,
  requested_limit integer default 20,
  requested_cursor text default null
) returns table (
  event_key text,
  action text,
  occurred_at timestamptz,
  actor_display_name text,
  before_title text,
  before_amount_krw bigint,
  before_participant_count integer,
  before_total_amount_krw bigint,
  after_title text,
  after_amount_krw bigint,
  after_participant_count integer,
  after_total_amount_krw bigint,
  next_cursor text
)
language plpgsql stable security definer set search_path = '' as $$
declare
  current_user_id uuid := auth.uid();
  bounded_limit integer := least(greatest(coalesce(requested_limit, 20), 1), 50);
  cursor_time timestamptz;
  cursor_event_id uuid;
  decoded_cursor text;
begin
  if current_user_id is null then
    raise exception 'authentication_required';
  end if;

  if requested_trip_id is null or requested_trip_id !~ '^[A-Za-z0-9_-]{1,128}$' then
    raise exception 'trip_not_found_or_forbidden';
  end if;

  -- Scope check mirrors the sync snapshot contract: the trip must be present
  -- in this group's current client snapshot and the caller must be active.
  if not exists (
    select 1
    from public.groups g
    join public.group_members m
      on m.group_id = g.id
     and m.user_id = current_user_id
     and m.status = 'active'
    where g.id = requested_group_id
      and exists (
        select 1
        from jsonb_array_elements(case
          when jsonb_typeof(g.client_snapshot #> '{group,trips}') = 'array'
            then g.client_snapshot #> '{group,trips}'
          else '[]'::jsonb
        end) trip(value)
        where trip.value ->> 'id' = requested_trip_id
      )
  ) then
    raise exception 'trip_not_found_or_forbidden';
  end if;

  if requested_cursor is not null then
    begin
      if pg_catalog.length(requested_cursor) > 256
         or requested_cursor !~ '^[A-Za-z0-9+/]+={0,2}$' then
        raise exception 'invalid_expense_audit_cursor';
      end if;
      decoded_cursor := pg_catalog.convert_from(pg_catalog.decode(requested_cursor, 'base64'), 'UTF8');
      if decoded_cursor !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\.[0-9]{6}Z\|[0-9a-fA-F-]{36}$' then
        raise exception 'invalid_expense_audit_cursor';
      end if;
      cursor_time := pg_catalog.split_part(decoded_cursor, '|', 1)::timestamptz;
      cursor_event_id := pg_catalog.split_part(decoded_cursor, '|', 2)::uuid;
    exception when others then
      raise exception 'invalid_expense_audit_cursor';
    end;
  end if;

  return query
  with candidates as materialized (
    select e.id, e.action, e.created_at, e.actor_user_id,
      a.before_state, a.after_state
    from public.group_sync_events e
    join public.group_sync_event_audit a
      on a.event_id = e.id
     and a.action = e.action
    where e.group_id = requested_group_id
      and e.trip_client_id = requested_trip_id
      and e.action in ('expense.create','expense.update','expense.delete',
                       'settlement.complete','settlement.reopen')
      and (cursor_time is null or (e.created_at, e.id) < (cursor_time, cursor_event_id))
    order by e.created_at desc, e.id desc
    limit bounded_limit + 1
  ), page as materialized (
    select * from candidates order by created_at desc, id desc limit bounded_limit
  ), page_info as (
    select count(*) > bounded_limit as has_more from candidates
  ), tail as (
    select created_at, id from page order by created_at asc, id asc limit 1
  )
  select
    pg_catalog.md5(p.id::text),
    p.action,
    p.created_at,
    (select m.display_name from public.group_members m
      where m.group_id = requested_group_id
        and m.user_id = p.actor_user_id and m.status = 'active'
      order by m.id limit 1),
    case when p.action like 'expense.%' then p.before_state ->> 'title' end,
    case when p.action like 'expense.%' then (p.before_state ->> 'amount')::bigint end,
    case when p.action like 'expense.%' then jsonb_array_length(p.before_state -> 'participantIds') end,
    case when p.action like 'expense.%' then (p.before_state ->> 'amount')::bigint end,
    case when p.action in ('expense.create','expense.update') then p.after_state ->> 'title' end,
    case when p.action in ('expense.create','expense.update') then (p.after_state ->> 'amount')::bigint end,
    case when p.action in ('expense.create','expense.update') then jsonb_array_length(p.after_state -> 'participantIds') end,
    case when p.action in ('expense.create','expense.update') then (p.after_state ->> 'amount')::bigint end,
    case when info.has_more and p.id = tail.id then
      pg_catalog.replace(pg_catalog.encode(pg_catalog.convert_to(
        pg_catalog.to_char(tail.created_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')
          || '|' || tail.id::text, 'UTF8'), 'base64'), E'\n', '')
      else null end
  from page p
  cross join page_info info
  cross join tail
  order by p.created_at desc, p.id desc;
end;
$$;

revoke all on function public.list_group_expense_audit(uuid, text, integer, text) from public, anon;
grant execute on function public.list_group_expense_audit(uuid, text, integer, text) to authenticated;

comment on function public.list_group_expense_audit(uuid, text, integer, text) is
  'Active-member-only, read-only allowlist for expense change history; never returns account IDs, entity IDs, or stored audit JSON.';
