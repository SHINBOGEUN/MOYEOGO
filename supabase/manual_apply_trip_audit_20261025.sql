BEGIN;

-- Migration 202610250001_group_trip_change_audit.sql
-- Keep private before/after audit details for expense and settlement commands.
-- Capture triggers run inside apply_group_trip_sync_change's transaction. The
-- existing group_sync_events row remains the public, active-member feed entry.

create table public.group_sync_event_audit (
  event_id uuid primary key references public.group_sync_events(id) on delete cascade,
  actor_user_id uuid not null references auth.users(id),
  action text not null check (action in (
    'expense.create','expense.update','expense.delete',
    'settlement.complete','settlement.reopen'
  )),
  occurred_at timestamptz not null,
  before_state jsonb,
  after_state jsonb,
  created_at timestamptz not null default clock_timestamp(),
  check (before_state is null or jsonb_typeof(before_state) = 'object'),
  check (after_state is null or jsonb_typeof(after_state) = 'object')
);

alter table public.group_sync_event_audit enable row level security;
revoke all on public.group_sync_event_audit from public, anon, authenticated;
revoke insert, update, delete, truncate on public.group_sync_events from public, anon, authenticated;

create or replace function public.capture_group_trip_audit_change()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  action_value text;
  before_value jsonb;
  after_value jsonb;
begin
  if tg_table_name = 'group_trip_sync_expenses' then
    if tg_op = 'INSERT' then
      action_value := 'expense.create';
      before_value := null;
    elsif old.deleted_at is null and new.deleted_at is not null then
      action_value := 'expense.delete';
      before_value := jsonb_build_object(
        'title',old.title,'amount',old.amount_krw,'payerId',old.payer_member_client_id,
        'participantIds',old.participant_member_client_ids,'version',old.version,'deletedAt',old.deleted_at
      );
    else
      action_value := 'expense.update';
      before_value := jsonb_build_object(
        'title',old.title,'amount',old.amount_krw,'payerId',old.payer_member_client_id,
        'participantIds',old.participant_member_client_ids,'version',old.version,'deletedAt',old.deleted_at
      );
    end if;
    after_value := jsonb_build_object(
      'title',new.title,'amount',new.amount_krw,'payerId',new.payer_member_client_id,
      'participantIds',new.participant_member_client_ids,'version',new.version,'deletedAt',new.deleted_at
    );
    perform pg_catalog.set_config('app.moyeogo_sync_audit', jsonb_build_object(
      'actorUserId',auth.uid(),'action',action_value,'entityType','expense',
      'tripId',new.trip_client_id,'entityId',new.expense_client_id,
      'before',before_value,'after',after_value
    )::text, true);
  elsif tg_table_name = 'group_trip_sync_state' and old.settled_at is distinct from new.settled_at then
    action_value := case when new.settled_at is null then 'settlement.reopen' else 'settlement.complete' end;
    before_value := jsonb_build_object('settledAt',old.settled_at,'version',old.settlement_version);
    after_value := jsonb_build_object('settledAt',new.settled_at,'version',new.settlement_version);
    perform pg_catalog.set_config('app.moyeogo_sync_audit', jsonb_build_object(
      'actorUserId',auth.uid(),'action',action_value,'entityType','settlement',
      'tripId',new.trip_client_id,'entityId',new.trip_client_id,
      'before',before_value,'after',after_value
    )::text, true);
  end if;
  return new;
end;
$$;
revoke all on function public.capture_group_trip_audit_change() from public, anon, authenticated;

create trigger group_trip_expense_audit_capture
  after insert or update on public.group_trip_sync_expenses
  for each row execute function public.capture_group_trip_audit_change();
create trigger group_trip_settlement_audit_capture
  after update of settled_at on public.group_trip_sync_state
  for each row execute function public.capture_group_trip_audit_change();

create or replace function public.append_group_sync_event_audit()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  detail jsonb;
begin
  detail := nullif(current_setting('app.moyeogo_sync_audit', true), '')::jsonb;
  if detail is null then return new; end if;
  if detail ->> 'actorUserId' is distinct from new.actor_user_id::text
     or detail ->> 'action' is distinct from new.action
     or detail ->> 'entityType' is distinct from new.entity_type
     or detail ->> 'tripId' is distinct from new.trip_client_id
     or detail ->> 'entityId' is distinct from new.entity_client_id then
    raise exception 'sync_audit_event_mismatch';
  end if;
  insert into public.group_sync_event_audit(event_id,actor_user_id,action,occurred_at,before_state,after_state)
  values (new.id,new.actor_user_id,new.action,new.created_at,
    nullif(detail -> 'before','null'::jsonb),nullif(detail -> 'after','null'::jsonb));
  perform pg_catalog.set_config('app.moyeogo_sync_audit', '', true);
  return new;
end;
$$;
revoke all on function public.append_group_sync_event_audit() from public, anon, authenticated;

create trigger group_sync_event_private_audit
  after insert on public.group_sync_events
  for each row execute function public.append_group_sync_event_audit();

comment on table public.group_sync_event_audit is
  'Private immutable-by-client audit details for expense and settlement sync commands; never expose through the group activity API.';
comment on function public.capture_group_trip_audit_change() is
  'Captures old/new expense or settlement values transaction-locally for the matching sync event.';
comment on function public.append_group_sync_event_audit() is
  'Persists matching private audit details atomically with the public group sync event.';

-- Migration 202610250002_group_expense_audit_read_api.sql
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

COMMIT;

