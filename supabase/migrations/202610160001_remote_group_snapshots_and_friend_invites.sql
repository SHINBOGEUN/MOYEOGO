-- Preserve the app's string IDs and complete local trip model without silently importing
-- device-local records. Account membership stays in the existing normalized access tables.
alter table public.groups add column client_group_id text;
alter table public.groups add column client_snapshot jsonb;
create unique index groups_owner_client_group_id_unique on public.groups(owner_user_id, client_group_id)
  where client_group_id is not null;

alter table public.group_members add column client_member_id text;
alter table public.group_members add column invited_user_id uuid references auth.users(id) on delete cascade;
create unique index group_members_client_id_unique
  on public.group_members(group_id, client_member_id) where client_member_id is not null;
create index group_members_invited_user on public.group_members(invited_user_id) where invited_user_id is not null;
create unique index group_members_one_invitation_per_account
  on public.group_members(group_id, invited_user_id) where invited_user_id is not null;

create table public.group_member_invitations (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.groups(id) on delete cascade,
  group_member_id uuid not null,
  invited_user_id uuid not null references auth.users(id) on delete cascade,
  created_by_user_id uuid not null references auth.users(id),
  status text not null default 'pending' check (status in ('pending', 'accepted', 'revoked')),
  created_at timestamptz not null default now(),
  responded_at timestamptz,
  foreign key (group_id, group_member_id) references public.group_members(group_id, id) on delete cascade
);
create unique index group_member_invites_one_pending_target
  on public.group_member_invitations(group_member_id) where status = 'pending';
create index group_member_invites_inbox on public.group_member_invitations(invited_user_id, created_at desc)
  where status = 'pending';
alter table public.group_member_invitations enable row level security;
revoke all on public.group_member_invitations from anon, authenticated;

create or replace function public.save_group_snapshot(
  requested_group_id text,
  requested_name text,
  requested_members jsonb,
  requested_snapshot jsonb
) returns boolean language plpgsql security definer set search_path = '' as $$
declare
  current_user_id uuid := auth.uid();
  saved_group_id uuid;
  member_item jsonb;
  member_count integer := 0;
  friend_user_id uuid;
  linked_user_id uuid;
  saved_member_id uuid;
  owner_client_member_id text;
begin
  if current_user_id is null then raise exception 'authentication_required'; end if;
  if requested_group_id is null or length(requested_group_id) not between 1 and 128
     or requested_name is null or length(btrim(requested_name)) not between 1 and 120
     or jsonb_typeof(requested_members) <> 'array' or jsonb_array_length(requested_members) < 2
     or jsonb_typeof(requested_snapshot) <> 'object'
     or requested_snapshot ->> 'version' is distinct from '1'
     or jsonb_typeof(requested_snapshot -> 'group') is distinct from 'object'
     or requested_snapshot #>> '{group,id}' is distinct from requested_group_id
     or requested_snapshot #>> '{group,name}' is distinct from btrim(requested_name)
     or jsonb_typeof(requested_snapshot #> '{group,members}') is distinct from 'array'
     or jsonb_array_length(requested_snapshot #> '{group,members}') <> jsonb_array_length(requested_members)
     or jsonb_typeof(requested_snapshot #> '{group,trips}') is distinct from 'array'
     or octet_length(requested_snapshot::text) > 1000000 then
    raise exception 'invalid_group_snapshot';
  end if;
  if (select count(*) from jsonb_array_elements(requested_members) m
      where jsonb_typeof(m) <> 'object' or nullif(btrim(m ->> 'member_id'), '') is null
        or nullif(btrim(m ->> 'display_name'), '') is null
        or length(btrim(m ->> 'member_id')) > 128 or length(btrim(m ->> 'display_name')) > 120)
      > 0 then raise exception 'invalid_group_member'; end if;
  if exists (
    select 1 from jsonb_array_elements(requested_members) m
    group by lower(btrim(m ->> 'display_name')) having count(*) > 1
  ) or exists (
    select 1 from jsonb_array_elements(requested_members) m
    group by btrim(m ->> 'member_id') having count(*) > 1
  ) then raise exception 'duplicate_group_member'; end if;
  owner_client_member_id := btrim(requested_members -> 0 ->> 'member_id');
  if requested_snapshot #>> '{group,members,0,id}' is distinct from owner_client_member_id
     or requested_snapshot #>> '{group,members,0,name}' is distinct from btrim(requested_members -> 0 ->> 'display_name') then
    raise exception 'owner_must_be_first_member';
  end if;
  if exists (
    select 1 from jsonb_array_elements(requested_members) with ordinality as requested(item, ordinal)
    join jsonb_array_elements(requested_snapshot #> '{group,members}') with ordinality as snapshot(item, ordinal)
      using (ordinal)
    where requested.item ->> 'member_id' <> snapshot.item ->> 'id'
      or btrim(requested.item ->> 'display_name') <> btrim(snapshot.item ->> 'name')
  ) then raise exception 'snapshot_member_mismatch'; end if;

  insert into public.groups(name, owner_user_id, client_group_id, client_snapshot)
  values (btrim(requested_name), current_user_id, requested_group_id, requested_snapshot)
  on conflict (owner_user_id, client_group_id) where client_group_id is not null
  do update set name = excluded.name, client_snapshot = excluded.client_snapshot, updated_at = now()
  where public.groups.owner_user_id = current_user_id
  returning id into saved_group_id;
  if saved_group_id is null then raise exception 'group_not_found_or_not_owner'; end if;

  if exists (
    select 1 from public.group_members gm
    where gm.group_id = saved_group_id and gm.user_id is not null and gm.user_id <> current_user_id
      and not exists (select 1 from jsonb_array_elements(requested_members) m
                      where btrim(m ->> 'member_id') = gm.client_member_id)
  ) then raise exception 'cannot_remove_linked_group_member'; end if;

  update public.group_members set client_member_id = owner_client_member_id,
    display_name = btrim(requested_members -> 0 ->> 'display_name'), updated_at = now()
  where group_id = saved_group_id and user_id = current_user_id and role = 'owner' and status = 'active';
  if not found then raise exception 'group_owner_member_missing'; end if;

  for member_item in select value from jsonb_array_elements(requested_members) with ordinality as rows(value, ordinal) where ordinal > 1 loop
    member_count := member_count + 1;
    friend_user_id := nullif(member_item ->> 'friend_user_id', '')::uuid;
    if friend_user_id is not null and not exists (
      select 1 from public.friend_requests fr
      where fr.status = 'accepted' and least(fr.requester_user_id, fr.addressee_user_id) = least(current_user_id, friend_user_id)
        and greatest(fr.requester_user_id, fr.addressee_user_id) = greatest(current_user_id, friend_user_id)
    ) then raise exception 'invitee_must_be_an_accepted_friend'; end if;
    if friend_user_id = current_user_id then raise exception 'cannot_invite_self'; end if;

    insert into public.group_members(group_id, client_member_id, invited_user_id, display_name, role, status, sort_order)
    values (saved_group_id, btrim(member_item ->> 'member_id'), friend_user_id,
      btrim(member_item ->> 'display_name'), 'member', case when friend_user_id is null then 'active' else 'pending' end, member_count)
    on conflict (group_id, client_member_id) where client_member_id is not null
    do update set display_name = excluded.display_name,
      invited_user_id = case when public.group_members.user_id is null then excluded.invited_user_id else public.group_members.invited_user_id end,
      status = case when public.group_members.user_id is not null then 'active'
                    when excluded.invited_user_id is null then 'active' else 'pending' end,
      sort_order = excluded.sort_order, updated_at = now()
    returning id into saved_member_id;
    select user_id into linked_user_id from public.group_members where id = saved_member_id;

    if friend_user_id is not null then
      if linked_user_id is not null and linked_user_id <> friend_user_id then
        raise exception 'member_already_linked_to_another_account';
      end if;
      update public.group_member_invitations set status = 'revoked', responded_at = now()
      where group_member_id = saved_member_id and status = 'pending' and invited_user_id <> friend_user_id;
      if linked_user_id is null then
        insert into public.group_member_invitations(group_id, group_member_id, invited_user_id, created_by_user_id)
        values (saved_group_id, saved_member_id, friend_user_id, current_user_id)
        on conflict (group_member_id) where status = 'pending' do nothing;
        if exists (select 1 from public.group_member_invitations i where i.group_member_id = saved_member_id
                   and i.status = 'pending' and i.invited_user_id <> friend_user_id) then
          raise exception 'member_invitation_pending_for_another_account';
        end if;
      end if;
    else
      update public.group_member_invitations set status = 'revoked', responded_at = now()
      where group_member_id = saved_member_id and status = 'pending';
    end if;
  end loop;

  delete from public.group_members gm where gm.group_id = saved_group_id and gm.role = 'member'
    and gm.user_id is null and gm.status <> 'removed'
    and not exists (select 1 from jsonb_array_elements(requested_members) m where btrim(m ->> 'member_id') = gm.client_member_id);
  return true;
end;
$$;

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
    )
  ) order by g.created_at desc), '[]'::jsonb) into result
  from public.groups g where g.client_snapshot is not null and exists (
    select 1 from public.group_members gm where gm.group_id = g.id and gm.user_id = current_user_id and gm.status = 'active'
  );
  return result;
end;
$$;

create or replace function public.list_my_group_invitations()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare current_user_id uuid := auth.uid(); result jsonb;
begin
  if current_user_id is null then raise exception 'authentication_required'; end if;
  select coalesce(jsonb_agg(jsonb_build_object(
    'invitationId', i.id, 'groupId', g.client_group_id, 'groupName', g.name,
    'memberId', gm.client_member_id, 'memberName', gm.display_name,
    'friendUserId', i.invited_user_id, 'status', i.status, 'invitedAt', i.created_at
  ) order by i.created_at desc), '[]'::jsonb) into result
  from public.group_member_invitations i
  join public.groups g on g.id = i.group_id
  join public.group_members gm on gm.id = i.group_member_id and gm.group_id = i.group_id
  where i.invited_user_id = current_user_id and i.status = 'pending'
    and gm.invited_user_id = current_user_id and gm.status = 'pending';
  return result;
end;
$$;

create or replace function public.accept_group_member_invitation(requested_invitation_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare current_user_id uuid := auth.uid(); target_invitation public.group_member_invitations%rowtype;
  target_group_client_id text; target_member_client_id text;
begin
  if current_user_id is null then raise exception 'authentication_required'; end if;
  select * into target_invitation from public.group_member_invitations i
  where i.id = requested_invitation_id and i.invited_user_id = current_user_id and i.status = 'pending' for update;
  if target_invitation.id is null then raise exception 'invitation_not_found_or_already_handled'; end if;
  select g.client_group_id, gm.client_member_id into target_group_client_id, target_member_client_id
  from public.groups g join public.group_members gm on gm.group_id = g.id
  where g.id = target_invitation.group_id and gm.id = target_invitation.group_member_id;
  update public.group_members set user_id = current_user_id, invited_user_id = null, status = 'active', updated_at = now()
  where id = target_invitation.group_member_id and group_id = target_invitation.group_id
    and invited_user_id = current_user_id and user_id is null and status = 'pending';
  if not found then raise exception 'member_already_linked'; end if;
  update public.group_member_invitations set status = 'accepted', responded_at = now() where id = target_invitation.id;
  return jsonb_build_object('invitationId', target_invitation.id, 'groupId', target_group_client_id,
    'memberId', target_member_client_id, 'friendUserId', current_user_id, 'status', 'accepted');
end;
$$;

revoke all on function public.save_group_snapshot(text, text, jsonb, jsonb) from public, anon;
revoke all on function public.list_my_group_snapshots() from public, anon;
revoke all on function public.list_my_group_invitations() from public, anon;
revoke all on function public.accept_group_member_invitation(uuid) from public, anon;
grant execute on function public.save_group_snapshot(text, text, jsonb, jsonb) to authenticated;
grant execute on function public.list_my_group_snapshots() to authenticated;
grant execute on function public.list_my_group_invitations() to authenticated;
grant execute on function public.accept_group_member_invitation(uuid) to authenticated;

comment on column public.groups.client_snapshot is 'Versioned app-shaped snapshot; device-local records are uploaded only through explicit save.';
comment on column public.group_members.invited_user_id is 'Target account remains non-member until its invitation is accepted.';
