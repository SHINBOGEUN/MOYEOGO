-- Add a narrowly projected activity RPC with create-expense details.
-- The private audit row joins by its event_id PK/FK, written atomically by
-- the sync command triggers; no entity ID or raw audit JSON leaves the server.

create or replace function public.list_group_trip_activity(
  requested_group_id uuid,
  requested_trip_id text,
  requested_limit integer default 5,
  requested_cursor text default null
) returns table (
  id uuid,
  group_id uuid,
  trip_client_id text,
  action text,
  created_at timestamptz,
  actor_display_name text,
  expense_title text,
  expense_amount_krw bigint,
  next_cursor text
)
language plpgsql stable security definer set search_path = '' as $$
declare
  current_user_id uuid := auth.uid();
  bounded_limit integer := least(greatest(coalesce(requested_limit, 5), 1), 5);
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
        raise exception 'invalid_group_activity_cursor';
      end if;
      decoded_cursor := pg_catalog.convert_from(pg_catalog.decode(requested_cursor, 'base64'), 'UTF8');
      if decoded_cursor !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\.[0-9]{6}Z\|[0-9a-fA-F-]{36}$' then
        raise exception 'invalid_group_activity_cursor';
      end if;
      cursor_time := pg_catalog.split_part(decoded_cursor, '|', 1)::timestamptz;
      cursor_event_id := pg_catalog.split_part(decoded_cursor, '|', 2)::uuid;
    exception when others then
      raise exception 'invalid_group_activity_cursor';
    end;
  end if;

  return query
  with candidates as materialized (
    select e.id, e.group_id, e.trip_client_id, e.action, e.created_at,
      e.actor_user_id, a.after_state
    from public.group_sync_events e
    left join public.group_sync_event_audit a
      on a.event_id = e.id
     and a.action = e.action
    where e.group_id = requested_group_id
      and e.trip_client_id = requested_trip_id
      and e.action in (
        'photo.upsert','photo.set_cover','photo.delete',
        'expense.create','expense.update','expense.delete',
        'settlement.complete','settlement.reopen'
      )
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
  select p.id, p.group_id, p.trip_client_id, p.action, p.created_at,
    (select m.display_name from public.group_members m
      where m.group_id = requested_group_id
        and m.user_id = p.actor_user_id and m.status = 'active'
      order by m.id limit 1),
    case when p.action = 'expense.create' then p.after_state ->> 'title' end,
    case when p.action = 'expense.create' then (p.after_state ->> 'amount')::bigint end,
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

revoke all on function public.list_group_trip_activity(uuid, text, integer, text) from public, anon;
grant execute on function public.list_group_trip_activity(uuid, text, integer, text) to authenticated;

comment on function public.list_group_trip_activity(uuid, text, integer, text) is
  'Active-member-only five-row trip activity page; only expense.create exposes title and whole-KRW amount, joined privately by audit event_id.';
