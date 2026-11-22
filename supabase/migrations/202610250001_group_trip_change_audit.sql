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
