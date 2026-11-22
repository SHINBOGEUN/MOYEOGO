-- Let signed-in users check a nickname without exposing profile records.
create or replace function public.check_nickname_available(requested_nickname text)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := auth.uid();
  clean_nickname text := regexp_replace(btrim(coalesce(requested_nickname, '')), '\s+', ' ', 'g');
begin
  if current_user_id is null then
    raise exception 'not_authenticated';
  end if;

  if char_length(clean_nickname) < 2 or char_length(clean_nickname) > 16
     or clean_nickname !~ '^[가-힣A-Za-z0-9_ ]+$' then
    raise exception 'invalid_nickname';
  end if;

  return not exists (
    select 1
    from public.profiles p
    where lower(p.nickname) = lower(clean_nickname)
      and p.user_id <> current_user_id
  );
end;
$$;

revoke all on function public.check_nickname_available(text) from public, anon;
grant execute on function public.check_nickname_available(text) to authenticated;

notify pgrst, 'reload schema';
