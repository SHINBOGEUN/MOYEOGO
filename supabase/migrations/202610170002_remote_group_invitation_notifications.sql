-- Add recipient-scoped invitation notifications and record acceptance for the creator.
-- Existing invitation rows, RPC names, and member/group data remain compatible.

alter table public.group_notifications
  drop constraint group_notifications_notification_type_check;
alter table public.group_notifications
  add constraint group_notifications_notification_type_check
  check (notification_type in ('member_left', 'group_invitation', 'invitation_accepted'));
alter table public.group_notifications
  add column invitation_id uuid references public.group_member_invitations(id) on delete cascade;

create unique index group_notifications_one_invitation_notice
  on public.group_notifications(invitation_id)
  where notification_type = 'group_invitation' and invitation_id is not null;

-- Backfill only invitations whose recipient, pending member, creator, and group owner
-- are all linked by the existing normalized rows. Do not infer invitations from members.
insert into public.group_notifications(
  recipient_user_id, group_id, group_client_id, group_name,
  member_client_id, member_name, notification_type, invitation_id
)
select i.invited_user_id, g.id, coalesce(g.client_group_id, g.id::text), g.name,
       coalesce(gm.client_member_id, gm.id::text), gm.display_name,
       'group_invitation', i.id
from public.group_member_invitations i
join public.groups g on g.id = i.group_id
join public.group_members gm on gm.id = i.group_member_id and gm.group_id = i.group_id
where i.status = 'pending'
  and i.created_by_user_id = g.owner_user_id
  and gm.status = 'pending'
  and gm.user_id is null
  and gm.invited_user_id = i.invited_user_id
  and exists (
    select 1 from public.group_members owner_member
    where owner_member.group_id = g.id
      and owner_member.user_id = g.owner_user_id
      and owner_member.role = 'owner'
      and owner_member.status = 'active'
  )
  and not exists (
    select 1 from public.group_notifications n
    where n.invitation_id = i.id and n.notification_type = 'group_invitation'
  )
on conflict (invitation_id)
  where notification_type = 'group_invitation' and invitation_id is not null
  do nothing;

-- The existing save_group_snapshot RPC inserts an invitation only when a registered friend
-- is newly invited. Recording it from an AFTER INSERT trigger avoids duplicate notices on
-- idempotent snapshot saves and keeps guest members outside the invitation flow.
create or replace function public.record_group_invitation_notification()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  target_group_name text;
  target_group_client_id text;
  target_member_name text;
  target_member_client_id text;
begin
  select g.name, coalesce(g.client_group_id, g.id::text), gm.display_name,
         coalesce(gm.client_member_id, gm.id::text)
    into target_group_name, target_group_client_id, target_member_name, target_member_client_id
  from public.groups g
  join public.group_members gm on gm.group_id = g.id
  where g.id = new.group_id and gm.id = new.group_member_id
    and gm.status = 'pending' and gm.invited_user_id = new.invited_user_id;

  if target_group_name is null then
    raise exception 'invited_group_member_not_pending';
  end if;

  insert into public.group_notifications(
    recipient_user_id, group_id, group_client_id, group_name,
    member_client_id, member_name, notification_type, invitation_id
  ) values (
    new.invited_user_id, new.group_id, target_group_client_id, target_group_name,
    target_member_client_id, target_member_name, 'group_invitation', new.id
  );
  return new;
end;
$$;

revoke all on function public.record_group_invitation_notification() from public, anon, authenticated;
create trigger group_member_invitation_record_notification
  after insert on public.group_member_invitations
  for each row execute function public.record_group_invitation_notification();

-- Return the same accepted-invitation fields as before, with active membership and
-- notification details added. The transaction boundary makes all three writes atomic.
create or replace function public.accept_group_member_invitation(requested_invitation_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  current_user_id uuid := auth.uid();
  target_invitation public.group_member_invitations%rowtype;
  target_group_client_id text;
  target_group_name text;
  target_member_client_id text;
  target_member_name text;
  owner_user_id uuid;
  accepted_notification_id uuid;
begin
  if current_user_id is null then raise exception 'authentication_required'; end if;

  select * into target_invitation
  from public.group_member_invitations i
  where i.id = requested_invitation_id and i.invited_user_id = current_user_id
  for update;
  if target_invitation.id is null then raise exception 'invitation_not_found_or_already_handled'; end if;

  select g.client_group_id, g.name, g.owner_user_id, gm.client_member_id, gm.display_name
    into target_group_client_id, target_group_name, owner_user_id, target_member_client_id, target_member_name
  from public.groups g
  join public.group_members gm on gm.group_id = g.id
  where g.id = target_invitation.group_id and gm.id = target_invitation.group_member_id;
  if owner_user_id is null then raise exception 'invitation_not_found_or_already_handled'; end if;

  if target_invitation.status = 'accepted' then
    if not exists (
      select 1 from public.group_members gm
      where gm.id = target_invitation.group_member_id and gm.group_id = target_invitation.group_id
        and gm.user_id = current_user_id and gm.status = 'active'
    ) then raise exception 'invitation_not_found_or_already_handled'; end if;

    select n.id into accepted_notification_id
    from public.group_notifications n
    where n.invitation_id = target_invitation.id and n.notification_type = 'invitation_accepted'
      and n.recipient_user_id = owner_user_id;
    if accepted_notification_id is null then
      insert into public.group_notifications(
        recipient_user_id, group_id, group_client_id, group_name,
        member_client_id, member_name, notification_type, invitation_id
      ) values (
        owner_user_id, target_invitation.group_id,
        coalesce(target_group_client_id, target_invitation.group_id::text), target_group_name,
        coalesce(target_member_client_id, target_invitation.group_member_id::text),
        target_member_name, 'invitation_accepted', target_invitation.id
      ) returning id into accepted_notification_id;
    end if;
  elsif target_invitation.status = 'pending' then
    update public.group_members
    set user_id = current_user_id, invited_user_id = null, status = 'active', updated_at = now()
    where id = target_invitation.group_member_id and group_id = target_invitation.group_id
      and invited_user_id = current_user_id and user_id is null and status = 'pending';
    if not found then raise exception 'member_already_linked'; end if;

    update public.group_member_invitations
    set status = 'accepted', responded_at = now()
    where id = target_invitation.id and invited_user_id = current_user_id and status = 'pending';
    if not found then raise exception 'invitation_not_found_or_already_handled'; end if;

    insert into public.group_notifications(
      recipient_user_id, group_id, group_client_id, group_name,
      member_client_id, member_name, notification_type, invitation_id
    ) values (
      owner_user_id, target_invitation.group_id,
      coalesce(target_group_client_id, target_invitation.group_id::text), target_group_name,
      coalesce(target_member_client_id, target_invitation.group_member_id::text),
      target_member_name, 'invitation_accepted', target_invitation.id
    ) returning id into accepted_notification_id;
  else
    raise exception 'invitation_not_found_or_already_handled';
  end if;

  return jsonb_build_object(
    'invitationId', target_invitation.id,
    'groupId', coalesce(target_group_client_id, target_invitation.group_id::text),
    'memberId', coalesce(target_member_client_id, target_invitation.group_member_id::text),
    'friendUserId', current_user_id,
    'status', 'accepted',
    'membership', jsonb_build_object(
      'groupId', coalesce(target_group_client_id, target_invitation.group_id::text),
      'userId', current_user_id,
      'status', 'active'
    ),
    'notification', jsonb_build_object(
      'id', accepted_notification_id,
      'type', 'invitation_accepted',
      'groupId', coalesce(target_group_client_id, target_invitation.group_id::text)
    )
  );
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
    'invitationId', n.invitation_id,
    'createdAt', n.created_at,
    'readAt', null
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

revoke all on function public.accept_group_member_invitation(uuid) from public, anon;
grant execute on function public.accept_group_member_invitation(uuid) to authenticated;
revoke all on function public.list_my_group_notifications() from public, anon;
grant execute on function public.list_my_group_notifications() to authenticated;

comment on column public.group_notifications.invitation_id is 'Invitation linked to a recipient-scoped invitation or creator acceptance event.';
comment on function public.list_my_group_notifications() is 'Returns only notifications addressed to auth.uid(); invitation notices are returned only while that recipient invitation is pending.';
comment on table public.group_notifications is 'In-app group events; each authenticated user can query only notifications addressed to them.';
