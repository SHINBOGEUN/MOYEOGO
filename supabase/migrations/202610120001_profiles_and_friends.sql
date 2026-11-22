-- Unique account nicknames and friend connections. Apply after 202610100001_initial_schema.sql.
alter table public.profiles
  add column if not exists nickname text,
  add column if not exists friend_code text,
  add column if not exists notifications_enabled boolean not null default true;

create unique index if not exists profiles_nickname_unique_ci
  on public.profiles (lower(nickname)) where nickname is not null;
create unique index if not exists profiles_friend_code_unique
  on public.profiles (friend_code) where friend_code is not null;

create or replace function public.assign_profile_friend_code()
returns trigger language plpgsql security definer set search_path = '' as $$
declare candidate text;
begin
  if new.friend_code is null or btrim(new.friend_code) = '' then
    loop
      candidate := 'MG-' || upper(substr(encode(extensions.gen_random_bytes(8), 'hex'), 1, 8));
      exit when not exists (select 1 from public.profiles p where p.friend_code = candidate);
    end loop;
    new.friend_code := candidate;
  end if;
  return new;
end;
$$;
drop trigger if exists profiles_assign_friend_code on public.profiles;
create trigger profiles_assign_friend_code before insert or update of friend_code on public.profiles
for each row execute function public.assign_profile_friend_code();
revoke all on function public.assign_profile_friend_code() from public, anon, authenticated;
update public.profiles set friend_code = null where friend_code is null;

-- Also initialize accounts that existed before this migration was installed.
insert into public.profiles(user_id, display_name)
select u.id,
  coalesce(nullif(trim(u.raw_user_meta_data ->> 'display_name'), ''), split_part(coalesce(u.email, ''), '@', 1))
from auth.users u
on conflict (user_id) do nothing;

create table if not exists public.friend_requests (
  id uuid primary key default gen_random_uuid(),
  requester_user_id uuid not null references auth.users(id) on delete cascade,
  addressee_user_id uuid not null references auth.users(id) on delete cascade,
  status text not null default 'pending' check (status in ('pending', 'accepted', 'rejected')),
  created_at timestamptz not null default now(),
  responded_at timestamptz,
  check (requester_user_id <> addressee_user_id)
);
create unique index if not exists friend_requests_one_pending_pair
  on public.friend_requests (least(requester_user_id, addressee_user_id), greatest(requester_user_id, addressee_user_id))
  where status = 'pending';
create unique index if not exists friend_requests_one_accepted_pair
  on public.friend_requests (least(requester_user_id, addressee_user_id), greatest(requester_user_id, addressee_user_id))
  where status = 'accepted';
create index if not exists friend_requests_addressee_status on public.friend_requests(addressee_user_id, status);
alter table public.friend_requests enable row level security;
revoke all on public.friend_requests from anon, authenticated;

create or replace function public.get_my_social_data()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare current_user_id uuid := auth.uid(); result jsonb;
begin
  if current_user_id is null then raise exception 'not_authenticated'; end if;
  select jsonb_build_object(
    'profile', jsonb_build_object(
      'user_id', p.user_id, 'nickname', p.nickname, 'friend_code', p.friend_code,
      'notifications_enabled', p.notifications_enabled
    ),
    'friends', coalesce((
      select jsonb_agg(jsonb_build_object('user_id', other_profile.user_id, 'nickname', other_profile.nickname, 'friend_code', other_profile.friend_code)
                       order by lower(other_profile.nickname))
      from public.friend_requests fr
      join public.profiles other_profile on other_profile.user_id =
        case when fr.requester_user_id = current_user_id then fr.addressee_user_id else fr.requester_user_id end
      where fr.status = 'accepted' and current_user_id in (fr.requester_user_id, fr.addressee_user_id)
    ), '[]'::jsonb),
    'requests', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', fr.id, 'direction', case when fr.addressee_user_id = current_user_id then 'incoming' else 'outgoing' end,
        'status', 'pending', 'user_id', other_profile.user_id, 'nickname', other_profile.nickname,
        'friend_code', other_profile.friend_code, 'created_at', fr.created_at
      ) order by fr.created_at desc)
      from public.friend_requests fr
      join public.profiles other_profile on other_profile.user_id =
        case when fr.requester_user_id = current_user_id then fr.addressee_user_id else fr.requester_user_id end
      where fr.status = 'pending' and current_user_id in (fr.requester_user_id, fr.addressee_user_id)
    ), '[]'::jsonb)
  ) into result
  from public.profiles p where p.user_id = current_user_id;
  if result is null then raise exception 'profile_not_found'; end if;
  return result;
end;
$$;

create or replace function public.save_my_profile(requested_nickname text, requested_notifications_enabled boolean default true)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare current_user_id uuid := auth.uid(); clean_nickname text; saved_profile public.profiles%rowtype;
begin
  if current_user_id is null then raise exception 'not_authenticated'; end if;
  clean_nickname := regexp_replace(btrim(coalesce(requested_nickname, '')), '\s+', ' ', 'g');
  if char_length(clean_nickname) < 2 or char_length(clean_nickname) > 16
     or clean_nickname !~ '^[가-힣A-Za-z0-9_ ]+$' then raise exception 'invalid_nickname'; end if;
  update public.profiles set nickname = clean_nickname, display_name = clean_nickname,
    notifications_enabled = coalesce(requested_notifications_enabled, true), updated_at = now()
  where user_id = current_user_id returning * into saved_profile;
  if not found then raise exception 'profile_not_found'; end if;
  return jsonb_build_object('user_id', saved_profile.user_id, 'nickname', saved_profile.nickname,
    'friend_code', saved_profile.friend_code, 'notifications_enabled', saved_profile.notifications_enabled);
exception when unique_violation then raise exception 'nickname_taken';
end;
$$;

create or replace function public.lookup_friend_by_code(requested_friend_code text)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare current_user_id uuid := auth.uid(); found_profile public.profiles%rowtype; relation_status text;
begin
  if current_user_id is null then raise exception 'not_authenticated'; end if;
  select * into found_profile from public.profiles p where upper(p.friend_code) = upper(btrim(requested_friend_code));
  if not found then return null; end if;
  if found_profile.user_id = current_user_id then raise exception 'cannot_add_self'; end if;
  select fr.status into relation_status from public.friend_requests fr
    where least(fr.requester_user_id, fr.addressee_user_id) = least(current_user_id, found_profile.user_id)
      and greatest(fr.requester_user_id, fr.addressee_user_id) = greatest(current_user_id, found_profile.user_id)
      and fr.status in ('pending', 'accepted') order by (fr.status = 'accepted') desc limit 1;
  return jsonb_build_object('user_id', found_profile.user_id, 'nickname', found_profile.nickname,
    'friend_code', found_profile.friend_code, 'relation_status', relation_status);
end;
$$;

create or replace function public.send_friend_request(requested_friend_code text)
returns void language plpgsql security definer set search_path = '' as $$
declare current_user_id uuid := auth.uid(); target_user_id uuid;
begin
  if current_user_id is null then raise exception 'not_authenticated'; end if;
  select p.user_id into target_user_id from public.profiles p where upper(p.friend_code) = upper(btrim(requested_friend_code));
  if target_user_id is null then raise exception 'friend_not_found'; end if;
  if target_user_id = current_user_id then raise exception 'cannot_add_self'; end if;
  if exists (select 1 from public.friend_requests fr where least(fr.requester_user_id, fr.addressee_user_id) = least(current_user_id, target_user_id)
      and greatest(fr.requester_user_id, fr.addressee_user_id) = greatest(current_user_id, target_user_id) and fr.status = 'accepted') then
    raise exception 'already_friends';
  end if;
  if exists (select 1 from public.friend_requests fr where fr.requester_user_id = target_user_id and fr.addressee_user_id = current_user_id and fr.status = 'pending') then
    raise exception 'incoming_request_exists';
  end if;
  insert into public.friend_requests(requester_user_id, addressee_user_id) values (current_user_id, target_user_id);
exception when unique_violation then raise exception 'friend_request_exists';
end;
$$;

create or replace function public.respond_to_friend_request(request_id uuid, accept_request boolean)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null then raise exception 'not_authenticated'; end if;
  update public.friend_requests set status = case when accept_request then 'accepted' else 'rejected' end, responded_at = now()
    where id = request_id and addressee_user_id = auth.uid() and status = 'pending';
  if not found then raise exception 'request_not_found_or_already_handled'; end if;
end;
$$;

revoke all on function public.get_my_social_data() from public, anon;
revoke all on function public.save_my_profile(text, boolean) from public, anon;
revoke all on function public.lookup_friend_by_code(text) from public, anon;
revoke all on function public.send_friend_request(text) from public, anon;
revoke all on function public.respond_to_friend_request(uuid, boolean) from public, anon;
grant execute on function public.get_my_social_data() to authenticated;
grant execute on function public.save_my_profile(text, boolean) to authenticated;
grant execute on function public.lookup_friend_by_code(text) to authenticated;
grant execute on function public.send_friend_request(text) to authenticated;
grant execute on function public.respond_to_friend_request(uuid, boolean) to authenticated;

grant select (user_id, nickname, friend_code, notifications_enabled) on public.profiles to authenticated;
revoke update on public.profiles from authenticated;
revoke update (display_name, updated_at, nickname, notifications_enabled) on public.profiles from authenticated;
