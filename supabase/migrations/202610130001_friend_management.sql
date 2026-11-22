-- Let an authenticated user cancel their own pending request or remove an accepted friend.
-- Rows are deleted so either person can send a new request later.
create or replace function public.cancel_friend_request(request_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null then raise exception 'not_authenticated'; end if;
  delete from public.friend_requests
    where id = request_id and requester_user_id = auth.uid() and status = 'pending';
  if not found then raise exception 'request_not_found_or_already_handled'; end if;
end;
$$;

create or replace function public.remove_friend(friend_user_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null then raise exception 'not_authenticated'; end if;
  delete from public.friend_requests
    where status = 'accepted'
      and (requester_user_id = auth.uid() and addressee_user_id = friend_user_id
        or addressee_user_id = auth.uid() and requester_user_id = friend_user_id);
  if not found then raise exception 'friend_not_found'; end if;
end;
$$;

revoke all on function public.cancel_friend_request(uuid) from public, anon;
revoke all on function public.remove_friend(uuid) from public, anon;
grant execute on function public.cancel_friend_request(uuid) to authenticated;
grant execute on function public.remove_friend(uuid) to authenticated;
notify pgrst, 'reload schema';
