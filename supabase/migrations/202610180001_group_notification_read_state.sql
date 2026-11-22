-- Persist recipient-scoped read state without changing existing notification rows.
alter table public.group_notifications
  add column read_at timestamptz;

create index group_notifications_recipient_unread
  on public.group_notifications(recipient_user_id, created_at desc)
  where read_at is null;

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
    'invitationId', n.invitation_id,
    'createdAt', n.created_at,
    'readAt', n.read_at
  ) order by n.created_at desc), '[]'::jsonb) into result
  from public.group_notifications n
  where n.recipient_user_id = current_user_id
    and (n.notification_type <> 'group_invitation' or exists (
      select 1 from public.group_member_invitations i
      join public.group_members gm on gm.id = i.group_member_id and gm.group_id = i.group_id
      where i.id = n.invitation_id and i.invited_user_id = current_user_id and i.status = 'pending'
        and gm.invited_user_id = current_user_id and gm.status = 'pending'
    ));
  return result;
end;
$$;

create or replace function public.mark_my_group_notification_read(notification_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null then raise exception 'authentication_required'; end if;
  update public.group_notifications
  set read_at = coalesce(read_at, now())
  where id = notification_id and recipient_user_id = auth.uid();
  if not found then raise exception 'notification_not_found'; end if;
end;
$$;

revoke all on function public.list_my_group_notifications() from public, anon;
grant execute on function public.list_my_group_notifications() to authenticated;
revoke all on function public.mark_my_group_notification_read(uuid) from public, anon;
grant execute on function public.mark_my_group_notification_read(uuid) to authenticated;

comment on function public.mark_my_group_notification_read(uuid) is
  'Marks a notification addressed to auth.uid() as read; repeated calls preserve the original read timestamp.';
comment on column public.group_notifications.read_at is
  'Timestamp when the recipient first marked this notification as read.';

notify pgrst, 'reload schema';
