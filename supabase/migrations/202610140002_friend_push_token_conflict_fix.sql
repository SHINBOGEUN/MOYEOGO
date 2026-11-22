-- A PL/pgSQL parameter named push_token makes ON CONFLICT (push_token)
-- ambiguous. Name the unique constraint explicitly so registration works.
create or replace function public.register_my_push_token(push_token text, platform text)
returns void language plpgsql security definer set search_path = '' as $$
declare current_user_id uuid := auth.uid();
begin
  if current_user_id is null then raise exception 'not_authenticated'; end if;
  if push_token is null or push_token !~ '^(Expo|Exponent)PushToken\[[A-Za-z0-9_-]{16,200}\]$'
     or char_length(push_token) > 256 then raise exception 'invalid_push_token'; end if;
  if platform not in ('ios', 'android') then raise exception 'invalid_platform'; end if;
  if not exists (select 1 from public.profiles p where p.user_id = current_user_id and p.notifications_enabled)
    then raise exception 'notifications_disabled'; end if;
  perform pg_advisory_xact_lock(hashtextextended('push-devices:' || current_user_id::text, 0));
  insert into public.user_devices (user_id, push_token, platform, last_seen_at, disabled_at)
  values (current_user_id, push_token, platform, now(), null)
  on conflict on constraint user_devices_push_token_key do update
    set user_id = excluded.user_id,
        platform = excluded.platform,
        last_seen_at = now(),
        disabled_at = null;
  delete from public.user_devices d where d.id in (
    select old.id from public.user_devices old where old.user_id = current_user_id
      order by old.last_seen_at desc, old.id desc offset 10
  );
end;
$$;
revoke all on function public.register_my_push_token(text, text) from public, anon;
grant execute on function public.register_my_push_token(text, text) to authenticated;
