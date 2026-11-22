-- Keep destructive group lifecycle operations behind authenticated, owner checked RPCs.
drop policy if exists groups_delete_owner on public.groups;
revoke delete on public.groups from authenticated;

create table public.group_notifications (
  id uuid primary key default gen_random_uuid(),
  recipient_user_id uuid not null references auth.users(id) on delete cascade,
  group_id uuid not null references public.groups(id) on delete cascade,
  group_client_id text not null,
  group_name text not null,
  member_client_id text not null,
  member_name text not null,
  notification_type text not null check (notification_type = 'member_left'),
  created_at timestamptz not null default now()
);
create index group_notifications_recipient_created
  on public.group_notifications(recipient_user_id, created_at desc);
alter table public.group_notifications enable row level security;
revoke all on public.group_notifications from anon, authenticated;

-- Expose normalized membership state alongside the app-shaped snapshot so pending invites
-- are not mistaken for active members by the creator's client.
create or replace function public.list_my_group_snapshots()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare current_user_id uuid := auth.uid(); result jsonb;
begin
  if current_user_id is null then raise exception 'authentication_required'; end if;
  select coalesce(jsonb_agg(jsonb_build_object(
    'group', g.client_snapshot -> 'group',
    'memberAccounts', (
      select coalesce(jsonb_object_agg(gm.client_member_id, gm.user_id::text), '{}'::jsonb)
      from public.group_members gm
      where gm.group_id = g.id and gm.status = 'active' and gm.user_id is not null and gm.client_member_id is not null
    ),
    'memberStatuses', (
      select coalesce(jsonb_object_agg(gm.client_member_id, gm.status), '{}'::jsonb)
      from public.group_members gm
      where gm.group_id = g.id and gm.client_member_id is not null
    )
  ) order by g.created_at desc), '[]'::jsonb) into result
  from public.groups g where g.client_snapshot is not null and exists (
    select 1 from public.group_members gm where gm.group_id = g.id and gm.user_id = current_user_id and gm.status = 'active'
  );
  return result;
end;
$$;

create or replace function public.delete_remote_group(requested_group_id text)
returns boolean language plpgsql security definer set search_path = '' as $$
declare current_user_id uuid := auth.uid(); target_group_id uuid;
begin
  if current_user_id is null then raise exception 'authentication_required'; end if;
  select g.id into target_group_id from public.groups g
  where (g.client_group_id = requested_group_id or g.id::text = requested_group_id)
    and g.owner_user_id = current_user_id for update;
  if target_group_id is null then raise exception 'group_not_found_or_not_owner'; end if;

  -- Historical member references are restrictive FKs, so remove dependent trip rows first.
  delete from public.trips where group_id = target_group_id;
  delete from public.group_members where group_id = target_group_id;
  delete from public.groups where id = target_group_id and owner_user_id = current_user_id;
  if not found then raise exception 'group_not_found_or_not_owner'; end if;
  return true;
end;
$$;

create or replace function public.leave_remote_group(requested_group_id text)
returns boolean language plpgsql security definer set search_path = '' as $$
declare
  current_user_id uuid := auth.uid();
  target_group_id uuid;
  target_member_id uuid;
  target_member_client_id text;
  target_member_name text;
  target_group_client_id text;
  target_group_name text;
  owner_id uuid;
begin
  if current_user_id is null then raise exception 'authentication_required'; end if;
  select g.id, g.client_group_id, g.name, g.owner_user_id, gm.id, gm.client_member_id, gm.display_name
    into target_group_id, target_group_client_id, target_group_name, owner_id,
      target_member_id, target_member_client_id, target_member_name
  from public.groups g
  join public.group_members gm on gm.group_id = g.id
  where (g.client_group_id = requested_group_id or g.id::text = requested_group_id)
    and gm.user_id = current_user_id and gm.role = 'member' and gm.status = 'active'
  for update of gm;
  if target_member_id is null then raise exception 'active_group_member_not_found'; end if;

  update public.group_members set user_id = null, invited_user_id = null,
    status = 'removed', updated_at = now()
  where id = target_member_id and group_id = target_group_id
    and user_id = current_user_id and role = 'member' and status = 'active';
  if not found then raise exception 'active_group_member_not_found'; end if;

  insert into public.group_notifications(
    recipient_user_id, group_id, group_client_id, group_name,
    member_client_id, member_name, notification_type
  ) values (
    owner_id, target_group_id, coalesce(target_group_client_id, target_group_id::text), target_group_name,
    coalesce(target_member_client_id, target_member_id::text), target_member_name, 'member_left'
  );
  return true;
end;
$$;

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
    'createdAt', n.created_at,
    'readAt', null
  ) order by n.created_at desc), '[]'::jsonb) into result
  from public.group_notifications n where n.recipient_user_id = current_user_id;
  return result;
end;
$$;

revoke all on function public.delete_remote_group(text), public.leave_remote_group(text),
  public.list_my_group_notifications() from public, anon;
grant execute on function public.delete_remote_group(text), public.leave_remote_group(text),
  public.list_my_group_notifications() to authenticated;
revoke all on function public.list_my_group_snapshots() from public, anon;
grant execute on function public.list_my_group_snapshots() to authenticated;

comment on table public.group_notifications is 'In-app group lifecycle events; only the group creator can fetch their notifications.';
comment on function public.leave_remote_group(text) is 'Only an active non-owner account member may leave; records a creator notification transactionally.';
