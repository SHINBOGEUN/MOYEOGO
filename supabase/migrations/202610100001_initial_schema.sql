-- Shared account and access-control foundation. Local device records are not migrated here.
create extension if not exists pgcrypto with schema extensions;

create table public.profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create table public.groups (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(trim(name)) between 1 and 120),
  owner_user_id uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table public.group_members (
  id uuid primary key default gen_random_uuid(), group_id uuid not null references public.groups(id) on delete cascade,
  user_id uuid references auth.users(id) on delete set null,
  display_name text not null check (length(trim(display_name)) between 1 and 120),
  role text not null default 'member' check (role in ('owner', 'member')),
  status text not null default 'pending' check (status in ('pending', 'active', 'removed')),
  sort_order integer not null default 0, created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  unique (group_id, id),
  check ((role = 'owner' and user_id is not null and status = 'active') or role = 'member')
);
create unique index group_members_one_account_per_group on public.group_members(group_id, user_id) where user_id is not null;
create table public.trips (
  id uuid primary key default gen_random_uuid(), group_id uuid not null references public.groups(id) on delete cascade,
  name text not null check (length(trim(name)) between 1 and 160), destination text not null default '', detail_address text not null default '',
  start_date date, end_date date, treasurer_member_id uuid not null, started_at timestamptz, ended_at timestamptz, settled_at timestamptz,
  settlement_input_version bigint not null default 1, created_by_user_id uuid not null default auth.uid() references auth.users(id),
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(), unique (group_id, id),
  foreign key (group_id, treasurer_member_id) references public.group_members(group_id, id),
  check (start_date is null or end_date is null or end_date >= start_date)
);
create table public.expenses (
  id uuid primary key default gen_random_uuid(), group_id uuid not null, trip_id uuid not null,
  title text not null check (length(trim(title)) between 1 and 160), amount_krw bigint not null check (amount_krw > 0),
  payer_member_id uuid not null, created_by_user_id uuid not null default auth.uid() references auth.users(id),
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(), unique (group_id, trip_id, id),
  foreign key (group_id, trip_id) references public.trips(group_id, id) on delete cascade,
  foreign key (group_id, payer_member_id) references public.group_members(group_id, id)
);
create table public.expense_participants (
  group_id uuid not null, trip_id uuid not null, expense_id uuid not null, group_member_id uuid not null, created_at timestamptz not null default now(),
  primary key (expense_id, group_member_id),
  foreign key (group_id, trip_id, expense_id) references public.expenses(group_id, trip_id, id) on delete cascade,
  foreign key (group_id, group_member_id) references public.group_members(group_id, id)
);
create table public.trip_photos (
  id uuid primary key default gen_random_uuid(), group_id uuid not null, trip_id uuid not null,
  storage_path text not null unique, latitude double precision check (latitude between -90 and 90), longitude double precision check (longitude between -180 and 180),
  is_cover boolean not null default false, added_by_user_id uuid not null default auth.uid() references auth.users(id), created_at timestamptz not null default now(),
  foreign key (group_id, trip_id) references public.trips(group_id, id) on delete cascade
);
create unique index trip_photos_one_cover_per_trip on public.trip_photos(trip_id) where is_cover;
create table public.settlement_requests (
  id uuid primary key default gen_random_uuid(), group_id uuid not null, trip_id uuid not null,
  created_by_user_id uuid not null default auth.uid() references auth.users(id),
  status text not null default 'pending' check (status in ('pending', 'completed', 'invalidated', 'cancelled')),
  input_version bigint not null, requested_at timestamptz not null default now(), completed_at timestamptz,
  foreign key (group_id, trip_id) references public.trips(group_id, id) on delete cascade
);
create table public.transfers (
  id uuid primary key default gen_random_uuid(), group_id uuid not null, request_id uuid not null references public.settlement_requests(id) on delete cascade,
  from_member_id uuid not null, to_member_id uuid not null, amount_krw bigint not null check (amount_krw > 0), confirmed_at timestamptz,
  check (from_member_id <> to_member_id),
  foreign key (group_id, from_member_id) references public.group_members(group_id, id),
  foreign key (group_id, to_member_id) references public.group_members(group_id, id)
);
create table public.group_invitations (
  id uuid primary key default gen_random_uuid(), group_id uuid not null, group_member_id uuid not null,
  created_by_user_id uuid not null references auth.users(id), token_hash bytea not null unique, expires_at timestamptz not null,
  consumed_at timestamptz, accepted_by_user_id uuid references auth.users(id), revoked_at timestamptz, created_at timestamptz not null default now(),
  foreign key (group_id, group_member_id) references public.group_members(group_id, id) on delete cascade,
  check ((consumed_at is null and accepted_by_user_id is null) or (consumed_at is not null and accepted_by_user_id is not null))
);
create table public.user_devices (
  id uuid primary key default gen_random_uuid(), user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  push_token text not null unique, platform text not null check (platform in ('ios', 'android')),
  last_seen_at timestamptz not null default now(), disabled_at timestamptz
);

create or replace function public.is_group_member(target_group uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.group_members gm where gm.group_id = target_group and gm.user_id = (select auth.uid()) and gm.status = 'active');
$$;
create or replace function public.is_group_owner(target_group uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.groups g where g.id = target_group and g.owner_user_id = (select auth.uid()));
$$;
create or replace function public.is_trip_treasurer(target_trip uuid, target_group uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.trips t join public.group_members gm on gm.group_id = t.group_id and gm.id = t.treasurer_member_id
    where t.id = target_trip and t.group_id = target_group and gm.user_id = (select auth.uid()) and gm.status = 'active');
$$;

create or replace function public.create_profile_for_auth_user() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.profiles(user_id, display_name)
  values (new.id, coalesce(nullif(trim(new.raw_user_meta_data ->> 'display_name'), ''), split_part(coalesce(new.email, ''), '@', 1)))
  on conflict (user_id) do nothing;
  return new;
end;
$$;
create trigger auth_user_profile_created after insert on auth.users for each row execute function public.create_profile_for_auth_user();
revoke all on function public.create_profile_for_auth_user() from public, anon, authenticated;

create or replace function public.create_group_owner_member() returns trigger
language plpgsql security definer set search_path = '' as $$
declare member_name text;
begin
  select coalesce(nullif(trim(p.display_name), ''), split_part(coalesce(u.email, ''), '@', 1), '모임장') into member_name
  from auth.users u left join public.profiles p on p.user_id = u.id where u.id = new.owner_user_id;
  insert into public.group_members(group_id, user_id, display_name, role, status, sort_order)
  values (new.id, new.owner_user_id, coalesce(nullif(member_name, ''), '모임장'), 'owner', 'active', 0);
  return new;
end;
$$;
create trigger groups_create_owner_member after insert on public.groups for each row execute function public.create_group_owner_member();
revoke all on function public.create_group_owner_member() from public, anon, authenticated;

create or replace function public.create_group_invitation(target_member uuid, valid_until timestamptz)
returns text language plpgsql security definer set search_path = '' as $$
declare target_group uuid; plain_token text;
begin
  select gm.group_id into target_group from public.group_members gm
  where gm.id = target_member and gm.user_id is null and gm.status = 'pending';
  if target_group is null or not public.is_group_owner(target_group) then raise exception 'not_allowed_or_invalid_member'; end if;
  if valid_until <= now() or valid_until > now() + interval '30 days' then raise exception 'invalid_expiry'; end if;
  plain_token := encode(extensions.gen_random_bytes(32), 'hex');
  insert into public.group_invitations(group_id, group_member_id, created_by_user_id, token_hash, expires_at)
  values (target_group, target_member, auth.uid(), extensions.digest(plain_token, 'sha256'), valid_until);
  return plain_token;
end;
$$;
create or replace function public.accept_group_invitation(plain_token text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare invitation public.group_invitations; linked_member uuid;
begin
  if auth.uid() is null then raise exception 'authentication_required'; end if;
  select * into invitation from public.group_invitations gi
  where gi.token_hash = extensions.digest(plain_token, 'sha256') and gi.consumed_at is null
    and gi.revoked_at is null and gi.expires_at > now() for update;
  if invitation.id is null then raise exception 'invitation_invalid_or_expired'; end if;
  update public.group_members gm set user_id = auth.uid(), status = 'active', updated_at = now()
  where gm.id = invitation.group_member_id and gm.group_id = invitation.group_id and gm.user_id is null and gm.status = 'pending'
  returning gm.id into linked_member;
  if linked_member is null then raise exception 'member_already_linked'; end if;
  update public.group_invitations gi set consumed_at = now(), accepted_by_user_id = auth.uid() where gi.id = invitation.id;
  return linked_member;
end;
$$;

create or replace function public.invalidate_pending_settlement(target_trip uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  update public.trips set settlement_input_version = settlement_input_version + 1, updated_at = now() where id = target_trip;
  update public.settlement_requests set status = 'invalidated' where trip_id = target_trip and status = 'pending';
end;
$$;
create or replace function public.expense_input_changed()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'DELETE' then perform public.invalidate_pending_settlement(old.trip_id); return old;
  elsif tg_op = 'UPDATE' then
    if old.trip_id is distinct from new.trip_id then perform public.invalidate_pending_settlement(old.trip_id); end if;
    perform public.invalidate_pending_settlement(new.trip_id); return new;
  end if;
  perform public.invalidate_pending_settlement(new.trip_id); return new;
end;
$$;
create trigger expense_input_changed after insert or delete or update of trip_id, amount_krw, payer_member_id
on public.expenses for each row execute function public.expense_input_changed();
create or replace function public.participant_input_changed()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'DELETE' then perform public.invalidate_pending_settlement(old.trip_id); return old; end if;
  if tg_op = 'UPDATE' and old.trip_id is distinct from new.trip_id then
    perform public.invalidate_pending_settlement(old.trip_id);
  end if;
  perform public.invalidate_pending_settlement(new.trip_id); return new;
end;
$$;
create trigger participant_input_changed after insert or delete or update of group_member_id, trip_id
on public.expense_participants for each row execute function public.participant_input_changed();
create or replace function public.member_input_changed()
returns trigger language plpgsql security definer set search_path = '' as $$
declare affected_trip record; target_group uuid;
begin
  if tg_op = 'DELETE' then target_group := old.group_id; else target_group := new.group_id; end if;
  for affected_trip in select t.id from public.trips t where t.group_id = target_group loop
    perform public.invalidate_pending_settlement(affected_trip.id);
  end loop;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;
create trigger member_input_changed after insert or update of status, user_id or delete on public.group_members
for each row execute function public.member_input_changed();

alter table public.profiles enable row level security;
alter table public.groups enable row level security;
alter table public.group_members enable row level security;
alter table public.trips enable row level security;
alter table public.expenses enable row level security;
alter table public.expense_participants enable row level security;
alter table public.trip_photos enable row level security;
alter table public.settlement_requests enable row level security;
alter table public.transfers enable row level security;
alter table public.group_invitations enable row level security;
alter table public.user_devices enable row level security;

create policy profiles_read_self on public.profiles for select to authenticated using (user_id = (select auth.uid()));
create policy profiles_update_self on public.profiles for update to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy groups_read_member on public.groups for select to authenticated using (public.is_group_member(id));
create policy groups_create_self on public.groups for insert to authenticated with check (owner_user_id = (select auth.uid()));
create policy groups_update_owner on public.groups for update to authenticated using (public.is_group_owner(id)) with check (public.is_group_owner(id));
create policy groups_delete_owner on public.groups for delete to authenticated using (public.is_group_owner(id));
create policy members_read_group on public.group_members for select to authenticated using (public.is_group_member(group_id));
create policy members_owner_insert_pending on public.group_members for insert to authenticated with check (
  public.is_group_owner(group_id) and role = 'member' and user_id is null and status = 'pending'
);
create policy members_owner_update_unlinked on public.group_members for update to authenticated using (
  public.is_group_owner(group_id) and role = 'member' and user_id is null and status = 'pending'
) with check (public.is_group_owner(group_id) and role = 'member' and user_id is null and status = 'pending');
create policy members_owner_delete_unlinked on public.group_members for delete to authenticated using (
  public.is_group_owner(group_id) and role = 'member' and user_id is null
);
create policy trips_read_group on public.trips for select to authenticated using (public.is_group_member(group_id));
create policy trips_create_member on public.trips for insert to authenticated with check (
  public.is_group_member(group_id) and exists (
    select 1 from public.group_members gm where gm.id = treasurer_member_id and gm.group_id = trips.group_id and gm.status <> 'removed'
  )
);
create policy trips_update_member on public.trips for update to authenticated using (public.is_group_member(group_id)) with check (public.is_group_member(group_id));
create policy trips_delete_owner on public.trips for delete to authenticated using (public.is_group_owner(group_id));
create policy expenses_read_group on public.expenses for select to authenticated using (public.is_group_member(group_id));
create policy expenses_create_member on public.expenses for insert to authenticated with check (
  public.is_group_member(group_id) and created_by_user_id = (select auth.uid())
  and exists (select 1 from public.group_members gm where gm.id = payer_member_id and gm.group_id = expenses.group_id and gm.status <> 'removed')
  and exists (select 1 from public.trips t where t.id = expenses.trip_id and t.group_id = expenses.group_id and t.settled_at is null)
);
create policy expenses_change_author_or_manager on public.expenses for update to authenticated using (
  (created_by_user_id = (select auth.uid()) or public.is_group_owner(group_id) or public.is_trip_treasurer(trip_id, group_id))
  and exists (select 1 from public.trips t where t.id = expenses.trip_id and t.group_id = expenses.group_id and t.settled_at is null)
) with check (
  public.is_group_member(group_id) and exists (select 1 from public.trips t where t.id = expenses.trip_id and t.group_id = expenses.group_id and t.settled_at is null)
);
create policy expenses_delete_author_or_manager on public.expenses for delete to authenticated using (
  (created_by_user_id = (select auth.uid()) or public.is_group_owner(group_id) or public.is_trip_treasurer(trip_id, group_id))
  and exists (select 1 from public.trips t where t.id = expenses.trip_id and t.group_id = expenses.group_id and t.settled_at is null)
);
create policy participants_read_group on public.expense_participants for select to authenticated using (public.is_group_member(group_id));
create policy participants_create_group on public.expense_participants for insert to authenticated with check (
  public.is_group_member(group_id) and exists (
    select 1 from public.group_members gm where gm.id = group_member_id and gm.group_id = expense_participants.group_id and gm.status <> 'removed'
  ) and exists (
    select 1 from public.expenses e where e.id = expense_id and e.trip_id = expense_participants.trip_id and e.group_id = expense_participants.group_id
      and (e.created_by_user_id = (select auth.uid()) or public.is_group_owner(e.group_id) or public.is_trip_treasurer(e.trip_id, e.group_id))
      and exists (select 1 from public.trips t where t.id = e.trip_id and t.group_id = e.group_id and t.settled_at is null)
  )
);
create policy participants_delete_author_or_manager on public.expense_participants for delete to authenticated using (
  public.is_group_member(group_id) and exists (
    select 1 from public.expenses e where e.id = expense_id and e.trip_id = expense_participants.trip_id and e.group_id = expense_participants.group_id
      and (e.created_by_user_id = (select auth.uid()) or public.is_group_owner(e.group_id) or public.is_trip_treasurer(e.trip_id, e.group_id))
      and exists (select 1 from public.trips t where t.id = e.trip_id and t.group_id = e.group_id and t.settled_at is null)
  )
);
create policy photos_read_group on public.trip_photos for select to authenticated using (public.is_group_member(group_id));
create policy photos_create_member on public.trip_photos for insert to authenticated with check (public.is_group_member(group_id) and added_by_user_id = (select auth.uid()));
create policy photos_delete_owner_or_uploader on public.trip_photos for delete to authenticated using (
  public.is_group_owner(group_id) or added_by_user_id = (select auth.uid())
);
create policy settlement_read_group on public.settlement_requests for select to authenticated using (public.is_group_member(group_id));
create policy transfers_read_group on public.transfers for select to authenticated using (public.is_group_member(group_id));
create policy devices_read_self on public.user_devices for select to authenticated using (user_id = (select auth.uid()));
create policy devices_insert_self on public.user_devices for insert to authenticated with check (user_id = (select auth.uid()));
create policy devices_update_self on public.user_devices for update to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy devices_delete_self on public.user_devices for delete to authenticated using (user_id = (select auth.uid()));

-- Remove any broad default grants before adding least-privilege column/table access.
revoke all on public.profiles, public.groups, public.group_members, public.trips, public.expenses,
  public.expense_participants, public.trip_photos, public.settlement_requests, public.transfers,
  public.group_invitations, public.user_devices from anon, authenticated;
grant usage on schema public to authenticated;
grant select on public.profiles to authenticated;
grant update (display_name, updated_at) on public.profiles to authenticated;
grant select on public.groups to authenticated;
grant insert (name, owner_user_id) on public.groups to authenticated;
grant update (name, updated_at) on public.groups to authenticated;
grant delete on public.groups to authenticated;
grant select on public.group_members to authenticated;
grant insert (group_id, display_name, sort_order) on public.group_members to authenticated;
grant update (display_name, sort_order, updated_at) on public.group_members to authenticated;
grant delete on public.group_members to authenticated;
grant select on public.trips to authenticated;
grant insert (group_id, name, destination, detail_address, start_date, end_date, treasurer_member_id) on public.trips to authenticated;
grant update (name, destination, detail_address, start_date, end_date, treasurer_member_id, updated_at) on public.trips to authenticated;
grant delete on public.trips to authenticated;
grant select on public.expenses to authenticated;
grant insert (group_id, trip_id, title, amount_krw, payer_member_id) on public.expenses to authenticated;
grant update (title, amount_krw, payer_member_id, updated_at) on public.expenses to authenticated;
grant delete on public.expenses to authenticated;
grant select, insert, delete on public.expense_participants to authenticated;
grant select, insert, delete on public.trip_photos to authenticated;
grant select on public.settlement_requests to authenticated;
grant select on public.transfers to authenticated;
grant select, insert, update, delete on public.user_devices to authenticated;
grant execute on function public.is_group_member(uuid), public.is_group_owner(uuid), public.is_trip_treasurer(uuid, uuid) to authenticated;
grant execute on function public.create_group_invitation(uuid, timestamptz), public.accept_group_invitation(text) to authenticated;
revoke all on function public.is_group_member(uuid), public.is_group_owner(uuid), public.is_trip_treasurer(uuid, uuid) from public, anon;
revoke all on function public.create_group_invitation(uuid, timestamptz), public.accept_group_invitation(text) from public, anon;
revoke all on public.group_invitations from anon, authenticated;
revoke all on function public.invalidate_pending_settlement(uuid), public.expense_input_changed(), public.participant_input_changed(), public.member_input_changed() from public, anon, authenticated;

comment on table public.group_invitations is 'One-time invitations target one pending group member; clients cannot read token hashes.';
comment on table public.trip_photos is 'Metadata only. Configure a private Storage bucket with equivalent membership policies before uploads.';
