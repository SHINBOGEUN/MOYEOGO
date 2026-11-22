-- Manual one-time application bundle for myg. Source of truth remains the five timestamped migration files.
-- Clean preflight was confirmed on 2026-10-24. Execute once; do not run supabase db push before reconciling CLI history.
BEGIN;
-- Normalized trip sync commands. Existing snapshots and user rows are untouched.
create table public.group_trip_sync_revisions (
  group_id uuid primary key references public.groups(id) on delete cascade,
  revision bigint not null default 0 check (revision >= 0),
  updated_at timestamptz not null default now()
);

create table public.group_trip_sync_state (
  group_id uuid not null references public.groups(id) on delete cascade,
  trip_client_id text not null check (trip_client_id ~ '^[A-Za-z0-9_-]{1,128}$'),
  cover_photo_id text,
  cover_version bigint not null default 0 check (cover_version >= 0),
  settled_at timestamptz,
  settlement_version bigint not null default 0 check (settlement_version >= 0),
  updated_at timestamptz not null default now(),
  primary key (group_id, trip_client_id)
);

create table public.group_trip_sync_photos (
  group_id uuid not null references public.groups(id) on delete cascade,
  trip_client_id text not null check (trip_client_id ~ '^[A-Za-z0-9_-]{1,128}$'),
  photo_client_id text not null check (photo_client_id ~ '^[A-Za-z0-9_-]{1,128}$'),
  storage_key text not null unique,
  mime_type text not null check (mime_type in ('image/jpeg','image/png','image/webp','image/heic','image/heif')),
  size_bytes bigint not null check (size_bytes between 1 and 20971520),
  width integer check (width is null or width between 1 and 30000),
  height integer check (height is null or height between 1 and 30000),
  latitude double precision check (latitude is null or latitude between -90 and 90),
  longitude double precision check (longitude is null or longitude between -180 and 180),
  added_at timestamptz not null,
  added_by_user_id uuid not null references auth.users(id),
  version bigint not null default 1 check (version >= 1),
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (group_id, trip_client_id, photo_client_id),
  check (storage_key = group_id::text || '/' || trip_client_id || '/' || photo_client_id)
);

create table public.group_trip_sync_expenses (
  group_id uuid not null references public.groups(id) on delete cascade,
  trip_client_id text not null check (trip_client_id ~ '^[A-Za-z0-9_-]{1,128}$'),
  expense_client_id text not null check (expense_client_id ~ '^[A-Za-z0-9_-]{1,128}$'),
  title text not null check (length(btrim(title)) between 1 and 160),
  amount_krw bigint not null check (amount_krw between 1 and 9007199254740991),
  payer_member_client_id text not null,
  participant_member_client_ids jsonb not null check (
    jsonb_typeof(participant_member_client_ids) = 'array'
    and jsonb_array_length(participant_member_client_ids) between 1 and 100),
  created_by_user_id uuid not null references auth.users(id),
  version bigint not null default 1 check (version >= 1),
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (group_id, trip_client_id, expense_client_id)
);

create table public.group_sync_events (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.groups(id) on delete cascade,
  trip_client_id text not null,
  entity_type text not null check (entity_type in ('photo','expense','settlement')),
  entity_client_id text not null,
  action text not null,
  entity_version bigint not null,
  group_revision bigint not null,
  actor_user_id uuid not null references auth.users(id),
  created_at timestamptz not null default clock_timestamp(),
  unique (group_id, group_revision)
);
create index group_sync_events_group_revision on public.group_sync_events(group_id, group_revision desc);

create table public.group_sync_idempotency (
  actor_user_id uuid not null references auth.users(id) on delete cascade,
  idempotency_key uuid not null,
  request_hash bytea not null,
  result jsonb not null,
  created_at timestamptz not null default now(),
  primary key (actor_user_id, idempotency_key)
);

alter table public.group_trip_sync_revisions enable row level security;
alter table public.group_trip_sync_state enable row level security;
alter table public.group_trip_sync_photos enable row level security;
alter table public.group_trip_sync_expenses enable row level security;
alter table public.group_sync_events enable row level security;
alter table public.group_sync_idempotency enable row level security;
create policy group_trip_sync_revisions_read_active on public.group_trip_sync_revisions
  for select to authenticated using (public.is_group_member(group_id));
create policy group_trip_sync_state_read_active on public.group_trip_sync_state
  for select to authenticated using (public.is_group_member(group_id));
create policy group_trip_sync_photos_read_active on public.group_trip_sync_photos
  for select to authenticated using (public.is_group_member(group_id));
create policy group_trip_sync_expenses_read_active on public.group_trip_sync_expenses
  for select to authenticated using (public.is_group_member(group_id));
create policy group_sync_events_read_active on public.group_sync_events
  for select to authenticated using (public.is_group_member(group_id));
revoke all on public.group_trip_sync_revisions, public.group_trip_sync_state,
  public.group_trip_sync_photos, public.group_trip_sync_expenses,
  public.group_sync_events, public.group_sync_idempotency from anon, authenticated;
grant select on public.group_trip_sync_revisions, public.group_trip_sync_state,
  public.group_trip_sync_photos, public.group_trip_sync_expenses, public.group_sync_events to authenticated;

-- Private photo objects use {groups.id}/{app trip ID}/{app photo ID}; URLs are never persisted.
insert into storage.buckets(id, name, public, file_size_limit, allowed_mime_types)
values ('moyeogo-trip-photos','moyeogo-trip-photos',false,20971520,
  array['image/jpeg','image/png','image/webp','image/heic','image/heif']) on conflict (id) do nothing;
do $$
begin
  if exists (select 1 from storage.buckets b where b.id='moyeogo-trip-photos'
    and (b.public or b.file_size_limit is distinct from 20971520
      or b.allowed_mime_types is distinct from array['image/jpeg','image/png','image/webp','image/heic','image/heif'])) then
    raise exception 'moyeogo_trip_photo_bucket_settings_conflict';
  end if;
end;
$$;
create policy moyeogo_trip_photo_objects_read_active on storage.objects for select to authenticated using (
  bucket_id = 'moyeogo-trip-photos' and exists (select 1 from public.group_members gm
    where gm.group_id::text = (storage.foldername(name))[1] and gm.user_id = (select auth.uid()) and gm.status = 'active')
  and exists (select 1 from public.group_trip_sync_photos p where p.storage_key=name and p.deleted_at is null));
create policy moyeogo_trip_photo_objects_insert_active on storage.objects for insert to authenticated with check (
  bucket_id = 'moyeogo-trip-photos' and exists (select 1 from public.group_members gm
    where gm.group_id::text = (storage.foldername(name))[1] and gm.user_id = (select auth.uid()) and gm.status = 'active'));
create policy moyeogo_trip_photo_objects_delete_active on storage.objects for delete to authenticated using (
  bucket_id = 'moyeogo-trip-photos' and exists (select 1 from public.group_members gm
    where gm.group_id::text = (storage.foldername(name))[1] and gm.user_id = (select auth.uid()) and gm.status = 'active')
  and exists (select 1 from public.group_trip_sync_photos p where p.storage_key=name
    and (p.added_by_user_id=(select auth.uid()) or exists (select 1 from public.groups g
      where g.id=p.group_id and g.owner_user_id=(select auth.uid())))));

create or replace function public.apply_group_trip_sync_change(
  requested_group_id uuid, requested_trip_id text, requested_action text,
  requested_entity_id text, requested_payload jsonb, expected_version bigint, idempotency_key uuid
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := auth.uid(); g public.groups%rowtype; m public.group_members%rowtype;
  prior public.group_sync_idempotency%rowtype; req_hash bytea; rev bigint; ver bigint;
  event_uuid uuid; entity jsonb; result jsonb; deleted boolean := false;
  title_value text; amount_value bigint; payer_value text; participants jsonb;
  photo_key text; mime_value text; size_value bigint; added_value timestamptz;
  width_value integer; height_value integer; lat_value double precision; lon_value double precision;
  settlement_value timestamptz; treasurer_id text; n integer;
begin
  if uid is null then raise exception 'authentication_required'; end if;
  if requested_group_id is null or requested_trip_id is null
     or requested_trip_id !~ '^[A-Za-z0-9_-]{1,128}$'
     or requested_entity_id is null or requested_entity_id !~ '^[A-Za-z0-9_-]{1,128}$'
     or idempotency_key is null or requested_action is null
     or requested_action not in ('photo.upsert','photo.set_cover','photo.delete',
       'expense.create','expense.update','expense.delete','settlement.complete','settlement.reopen')
     or jsonb_typeof(coalesce(requested_payload,'{}'::jsonb)) is distinct from 'object'
     or octet_length(coalesce(requested_payload,'{}'::jsonb)::text) > 16384 then
    raise exception 'invalid_sync_command';
  end if;
  req_hash := extensions.digest(convert_to(jsonb_build_array(requested_group_id,requested_trip_id,
    requested_action,requested_entity_id,coalesce(requested_payload,'{}'::jsonb),expected_version)::text,'UTF8'),'sha256');

  -- Serialize commands and revisions; validate the app trip against the current server snapshot.
  select x.* into g from public.groups x where x.id = requested_group_id for update;
  if g.id is null then raise exception 'trip_not_found_or_forbidden'; end if;
  select x.* into m from public.group_members x where x.group_id = g.id and x.user_id = uid
    and x.status = 'active' for update;
  if m.id is null then raise exception 'trip_not_found_or_forbidden'; end if;
  if not exists (select 1 from jsonb_array_elements(case
    when jsonb_typeof(g.client_snapshot #> '{group,trips}') = 'array'
      then g.client_snapshot #> '{group,trips}' else '[]'::jsonb end) t(value)
    where t.value ->> 'id' = requested_trip_id) then raise exception 'trip_not_found_or_forbidden'; end if;
  -- Even idempotent retries require current active membership.
  select i.* into prior from public.group_sync_idempotency i
    where i.actor_user_id = uid and i.idempotency_key = apply_group_trip_sync_change.idempotency_key;
  if prior.actor_user_id is not null then
    if prior.request_hash <> req_hash then raise exception 'idempotency_key_reused'; end if;
    return prior.result;
  end if;

  if requested_action in ('expense.update','expense.delete') then
    select t.value ->> 'treasurerId' into treasurer_id from jsonb_array_elements(
      case when jsonb_typeof(g.client_snapshot #> '{group,trips}') = 'array'
        then g.client_snapshot #> '{group,trips}' else '[]'::jsonb end) t(value)
      where t.value ->> 'id' = requested_trip_id limit 1;
    if g.owner_user_id <> uid and m.client_member_id is distinct from treasurer_id and not exists (
      select 1 from public.group_trip_sync_expenses e where e.group_id = g.id
        and e.trip_client_id = requested_trip_id and e.expense_client_id = requested_entity_id
        and e.created_by_user_id = uid) then raise exception 'expense_change_forbidden'; end if;
  end if;
  if requested_action like 'settlement.%' and requested_entity_id <> requested_trip_id then
    raise exception 'invalid_settlement_entity_id';
  end if;

  insert into public.group_trip_sync_revisions(group_id) values (g.id) on conflict do nothing;
  insert into public.group_trip_sync_state(group_id,trip_client_id) values (g.id,requested_trip_id)
    on conflict do nothing;

  if requested_action in ('photo.upsert','photo.set_cover') then
    if requested_payload ->> 'storageKey' is distinct from g.id::text || '/' || requested_trip_id || '/' || requested_entity_id
       or jsonb_typeof(requested_payload -> 'mimeType') is distinct from 'string'
       or jsonb_typeof(requested_payload -> 'sizeBytes') is distinct from 'number'
       or jsonb_typeof(requested_payload -> 'addedAt') is distinct from 'string' then raise exception 'invalid_photo_metadata'; end if;
    photo_key := requested_payload ->> 'storageKey'; mime_value := requested_payload ->> 'mimeType';
    size_value := (requested_payload ->> 'sizeBytes')::bigint;
    if (requested_payload ->> 'sizeBytes')::numeric <> trunc((requested_payload ->> 'sizeBytes')::numeric)
       or size_value not between 1 and 20971520 then raise exception 'invalid_photo_metadata'; end if;
    added_value := (requested_payload ->> 'addedAt')::timestamptz;
    width_value := nullif(requested_payload ->> 'width','')::integer;
    height_value := nullif(requested_payload ->> 'height','')::integer;
    lat_value := nullif(requested_payload ->> 'latitude','')::double precision;
    lon_value := nullif(requested_payload ->> 'longitude','')::double precision;
    if not exists (select 1 from storage.objects o where o.bucket_id='moyeogo-trip-photos'
      and o.name=photo_key) then raise exception 'photo_object_not_found'; end if;
    if requested_action='photo.set_cover' then
      select s.cover_version into ver from public.group_trip_sync_state s
        where s.group_id=g.id and s.trip_client_id=requested_trip_id for update;
      if expected_version is null or expected_version <> ver then raise exception 'sync_version_conflict'; end if;
      select jsonb_build_object('id',p.photo_client_id,'storageKey',p.storage_key,'mimeType',p.mime_type,
        'sizeBytes',p.size_bytes,'width',p.width,'height',p.height,'latitude',p.latitude,'longitude',p.longitude,
        'addedAt',p.added_at,'version',p.version) into entity from public.group_trip_sync_photos p
        where p.group_id=g.id and p.trip_client_id=requested_trip_id and p.photo_client_id=requested_entity_id
          and p.storage_key=photo_key and p.mime_type=mime_value and p.size_bytes=size_value
          and p.width is not distinct from width_value and p.height is not distinct from height_value
          and p.latitude is not distinct from lat_value and p.longitude is not distinct from lon_value
          and p.added_at=added_value and p.deleted_at is null;
      if entity is null then raise exception 'cover_photo_not_registered'; end if;
      update public.group_trip_sync_state s set cover_photo_id=requested_entity_id,
        cover_version=cover_version+1,updated_at=now()
        where s.group_id=g.id and s.trip_client_id=requested_trip_id;
      ver := ver + 1;
    else
      select p.version into ver from public.group_trip_sync_photos p where p.group_id = g.id
        and p.trip_client_id = requested_trip_id and p.photo_client_id = requested_entity_id for update;
      if ver is null then
        if expected_version is not null then raise exception 'sync_version_conflict'; end if;
        ver := 1;
        insert into public.group_trip_sync_photos(group_id,trip_client_id,photo_client_id,storage_key,
          mime_type,size_bytes,width,height,latitude,longitude,added_at,added_by_user_id)
        values (g.id,requested_trip_id,requested_entity_id,photo_key,mime_value,size_value,width_value,
          height_value,lat_value,lon_value,added_value,uid);
      else
        if exists (select 1 from public.group_trip_sync_photos p where p.group_id=g.id
          and p.trip_client_id=requested_trip_id and p.photo_client_id=requested_entity_id and p.deleted_at is not null)
          then raise exception 'sync_version_conflict'; end if;
        if expected_version is null or expected_version <> ver then raise exception 'sync_version_conflict'; end if;
        if not exists (select 1 from public.group_trip_sync_photos p where p.group_id=g.id
          and p.trip_client_id=requested_trip_id and p.photo_client_id=requested_entity_id
          and (p.added_by_user_id=uid or g.owner_user_id=uid) and p.deleted_at is null)
          then raise exception 'photo_change_forbidden'; end if;
        ver := ver + 1;
        update public.group_trip_sync_photos p set storage_key=photo_key,mime_type=mime_value,
          size_bytes=size_value,width=width_value,height=height_value,latitude=lat_value,longitude=lon_value,
          version=ver,updated_at=now() where p.group_id=g.id and p.trip_client_id=requested_trip_id
            and p.photo_client_id=requested_entity_id;
      end if;
      select jsonb_build_object('id',p.photo_client_id,'storageKey',p.storage_key,'mimeType',p.mime_type,
        'sizeBytes',p.size_bytes,'width',p.width,'height',p.height,'latitude',p.latitude,'longitude',p.longitude,
        'addedAt',p.added_at,'version',p.version) into entity from public.group_trip_sync_photos p
        where p.group_id=g.id and p.trip_client_id=requested_trip_id and p.photo_client_id=requested_entity_id
          and p.deleted_at is null;
    end if;
  elsif requested_action = 'photo.delete' then
    select p.version into ver from public.group_trip_sync_photos p where p.group_id=g.id
      and p.trip_client_id=requested_trip_id and p.photo_client_id=requested_entity_id
      and p.deleted_at is null for update;
    if ver is null or expected_version is null or expected_version <> ver then raise exception 'sync_version_conflict'; end if;
    if not exists (select 1 from public.group_trip_sync_photos p where p.group_id=g.id
      and p.trip_client_id=requested_trip_id and p.photo_client_id=requested_entity_id
      and p.deleted_at is null
      and (p.added_by_user_id=uid or g.owner_user_id=uid)) then raise exception 'photo_delete_forbidden'; end if;
    update public.group_trip_sync_photos p set deleted_at=now(),version=version+1,updated_at=now()
      where p.group_id=g.id and p.trip_client_id=requested_trip_id
        and p.photo_client_id=requested_entity_id and p.deleted_at is null;
    -- Deleting a cover is one atomic command: clear the cover and advance its own
    -- version so the next cover change on this device uses the current revision.
    update public.group_trip_sync_state s set cover_photo_id=null,
      cover_version=cover_version+1,updated_at=now()
      where s.group_id=g.id and s.trip_client_id=requested_trip_id and s.cover_photo_id=requested_entity_id;
    ver := ver + 1; deleted := true; entity := null;
  elsif requested_action like 'expense.%' then
    if exists (select 1 from public.group_trip_sync_state s where s.group_id=g.id
      and s.trip_client_id=requested_trip_id and s.settled_at is not null) then raise exception 'trip_settled'; end if;
    if requested_action in ('expense.create','expense.update') then
      if jsonb_typeof(requested_payload -> 'title') is distinct from 'string'
        or jsonb_typeof(requested_payload -> 'amount') is distinct from 'number'
        or (requested_payload ->> 'amount')::numeric <> trunc((requested_payload ->> 'amount')::numeric)
        or (requested_payload ->> 'amount')::numeric > 9007199254740991
        or jsonb_typeof(requested_payload -> 'payerId') is distinct from 'string'
        or jsonb_typeof(requested_payload -> 'participantIds') is distinct from 'array'
        or jsonb_array_length(requested_payload -> 'participantIds') not between 1 and 100
        or exists (select 1 from jsonb_array_elements(requested_payload -> 'participantIds') x
          where jsonb_typeof(x) <> 'string' or x #>> '{}' = '') then raise exception 'invalid_expense_payload'; end if;
      title_value := requested_payload ->> 'title'; amount_value := (requested_payload ->> 'amount')::bigint;
      payer_value := requested_payload ->> 'payerId';
      select coalesce(jsonb_agg(distinct x.value order by x.value),'[]'::jsonb) into participants
        from jsonb_array_elements_text(requested_payload -> 'participantIds') x(value);
      if jsonb_array_length(participants) <> jsonb_array_length(requested_payload -> 'participantIds')
         or not exists (select 1 from public.group_members gm where gm.group_id=g.id
           and gm.client_member_id=payer_value and gm.status <> 'removed')
         or exists (select 1 from jsonb_array_elements_text(participants) p(value)
           where not exists (select 1 from public.group_members gm where gm.group_id=g.id
             and gm.client_member_id=p.value and gm.status <> 'removed')) then raise exception 'invalid_expense_member'; end if;
      select e.version into ver from public.group_trip_sync_expenses e where e.group_id=g.id
        and e.trip_client_id=requested_trip_id and e.expense_client_id=requested_entity_id for update;
      if requested_action = 'expense.create' then
        if ver is not null or expected_version is not null then raise exception 'sync_version_conflict'; end if;
        ver := 1;
        insert into public.group_trip_sync_expenses(group_id,trip_client_id,expense_client_id,title,
          amount_krw,payer_member_client_id,participant_member_client_ids,created_by_user_id)
        values (g.id,requested_trip_id,requested_entity_id,btrim(title_value),amount_value,payer_value,participants,uid);
      else
        if ver is null or expected_version is null or expected_version <> ver then raise exception 'sync_version_conflict'; end if;
        ver := ver + 1;
        update public.group_trip_sync_expenses e set title=btrim(title_value),amount_krw=amount_value,
          payer_member_client_id=payer_value,participant_member_client_ids=participants,version=ver,updated_at=now()
          where e.group_id=g.id and e.trip_client_id=requested_trip_id and e.expense_client_id=requested_entity_id
            and e.deleted_at is null;
        if not found then raise exception 'sync_version_conflict'; end if;
      end if;
      select jsonb_build_object('id',e.expense_client_id,'title',e.title,'amount',e.amount_krw,
        'payerId',e.payer_member_client_id,'participantIds',e.participant_member_client_ids,
        'createdByUserId',e.created_by_user_id,'version',e.version) into entity
        from public.group_trip_sync_expenses e where e.group_id=g.id and e.trip_client_id=requested_trip_id
          and e.expense_client_id=requested_entity_id;
    else
      select e.version into ver from public.group_trip_sync_expenses e where e.group_id=g.id
        and e.trip_client_id=requested_trip_id and e.expense_client_id=requested_entity_id and e.deleted_at is null for update;
      if ver is null or expected_version is null or expected_version <> ver then raise exception 'sync_version_conflict'; end if;
      update public.group_trip_sync_expenses e set deleted_at=now(),version=version+1,updated_at=now()
        where e.group_id=g.id and e.trip_client_id=requested_trip_id and e.expense_client_id=requested_entity_id;
      ver := ver + 1; deleted := true; entity := null;
    end if;
  else
    select s.settlement_version,s.settled_at into ver,settlement_value from public.group_trip_sync_state s
      where s.group_id=g.id and s.trip_client_id=requested_trip_id for update;
    if expected_version is null or expected_version <> ver then raise exception 'sync_version_conflict'; end if;
    if requested_action='settlement.complete' then
      if settlement_value is not null then raise exception 'settlement_already_complete'; end if;
      settlement_value := clock_timestamp();
    else
      if settlement_value is null then raise exception 'settlement_not_complete'; end if;
      settlement_value := null;
    end if;
    ver := ver + 1;
    update public.group_trip_sync_state s set settled_at=settlement_value,settlement_version=ver,updated_at=now()
      where s.group_id=g.id and s.trip_client_id=requested_trip_id;
    entity := jsonb_build_object('tripId',requested_trip_id,'settledAt',settlement_value,'version',ver);
  end if;

  update public.group_trip_sync_revisions r set revision=r.revision+1,updated_at=now()
    where r.group_id=g.id returning r.revision into rev;
  insert into public.group_sync_events(group_id,trip_client_id,entity_type,entity_client_id,action,
    entity_version,group_revision,actor_user_id)
  values (g.id,requested_trip_id,case when requested_action like 'photo.%' then 'photo'
    when requested_action like 'expense.%' then 'expense' else 'settlement' end,
    requested_entity_id,requested_action,ver,rev,uid) returning id into event_uuid;
  if requested_action like 'photo.%' then entity := coalesce(entity,'null'::jsonb) || jsonb_build_object(
    'coverPhotoId',(select s.cover_photo_id from public.group_trip_sync_state s
      where s.group_id=g.id and s.trip_client_id=requested_trip_id)); end if;
  result := jsonb_build_object('eventId',event_uuid,'groupId',g.id,'tripId',requested_trip_id,
    'groupRevision',rev,'entity',entity,'entityVersion',ver,'deleted',deleted,
    'coverVersion',(select s.cover_version from public.group_trip_sync_state s
      where requested_action like 'photo.%' and s.group_id=g.id and s.trip_client_id=requested_trip_id));
  insert into public.group_sync_idempotency(actor_user_id,idempotency_key,request_hash,result)
    values (uid,idempotency_key,req_hash,result);
  return result;
end;
$$;

-- Return a coherent revision + state + entity snapshot from one MVCC view. Marking
-- the function STABLE makes its internal reads share the calling statement snapshot.
create or replace function public.load_group_trip_sync_snapshot(
  requested_group_id uuid, requested_trip_id text
) returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'groupRevision',coalesce((select r.revision from public.group_trip_sync_revisions r
      where r.group_id=g.id),0),
    'coverPhotoId',(select s.cover_photo_id from public.group_trip_sync_state s
      where s.group_id=g.id and s.trip_client_id=requested_trip_id),
    'coverVersion',coalesce((select s.cover_version from public.group_trip_sync_state s
      where s.group_id=g.id and s.trip_client_id=requested_trip_id),0),
    'settledAt',(select s.settled_at from public.group_trip_sync_state s
      where s.group_id=g.id and s.trip_client_id=requested_trip_id),
    'settlementVersion',coalesce((select s.settlement_version from public.group_trip_sync_state s
      where s.group_id=g.id and s.trip_client_id=requested_trip_id),0),
    'photos',coalesce((select jsonb_agg(jsonb_build_object(
      'id',p.photo_client_id,'storageKey',p.storage_key,'mimeType',p.mime_type,
      'sizeBytes',p.size_bytes,'width',p.width,'height',p.height,'latitude',p.latitude,
      'longitude',p.longitude,'addedAt',p.added_at,'version',p.version)
      order by p.added_at,p.photo_client_id)
      from public.group_trip_sync_photos p where p.group_id=g.id
        and p.trip_client_id=requested_trip_id and p.deleted_at is null),'[]'::jsonb),
    'expenses',coalesce((select jsonb_agg(jsonb_build_object(
      'id',e.expense_client_id,'title',e.title,'amount',e.amount_krw,
      'payerId',e.payer_member_client_id,'participantIds',e.participant_member_client_ids,
      'createdByUserId',e.created_by_user_id,'version',e.version)
      order by e.created_at,e.expense_client_id)
      from public.group_trip_sync_expenses e where e.group_id=g.id
        and e.trip_client_id=requested_trip_id and e.deleted_at is null),'[]'::jsonb)
  )
  from public.groups g
  join public.group_members m on m.group_id=g.id and m.user_id=(select auth.uid()) and m.status='active'
  where g.id=requested_group_id
    and requested_trip_id ~ '^[A-Za-z0-9_-]{1,128}$'
    and exists (select 1 from jsonb_array_elements(case
      when jsonb_typeof(g.client_snapshot #> '{group,trips}')='array'
        then g.client_snapshot #> '{group,trips}' else '[]'::jsonb end) t(value)
      where t.value ->> 'id'=requested_trip_id)
  limit 1;
$$;
revoke all on function public.load_group_trip_sync_snapshot(uuid,text) from public,anon;
grant execute on function public.load_group_trip_sync_snapshot(uuid,text) to authenticated;

create or replace function public.guard_group_sync_trip_removal()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if old.client_snapshot is null or jsonb_typeof(old.client_snapshot #> '{group,trips}') is distinct from 'array' then
    return new;
  end if;
  if new.client_snapshot is null or jsonb_typeof(new.client_snapshot #> '{group,trips}') is distinct from 'array' then
    raise exception 'invalid_group_snapshot';
  end if;
  if exists (
    select 1 from jsonb_array_elements(old.client_snapshot #> '{group,trips}') old_trip(value)
    where not exists (select 1 from jsonb_array_elements(new.client_snapshot #> '{group,trips}') new_trip(value)
      where new_trip.value ->> 'id' = old_trip.value ->> 'id')
      and (
        exists (select 1 from public.group_trip_sync_photos p where p.group_id=old.id
          and p.trip_client_id=old_trip.value ->> 'id' and p.deleted_at is null)
        or exists (select 1 from public.group_trip_sync_expenses e where e.group_id=old.id
          and e.trip_client_id=old_trip.value ->> 'id' and e.deleted_at is null)
        or exists (select 1 from public.group_trip_sync_state s where s.group_id=old.id
          and s.trip_client_id=old_trip.value ->> 'id' and s.settled_at is not null)
      )
  ) then raise exception 'GROUP_TRIP_HAS_SYNCED_DATA'; end if;
  return new;
end;
$$;
revoke all on function public.guard_group_sync_trip_removal() from public, anon, authenticated;
create trigger groups_guard_sync_trip_removal before update of client_snapshot on public.groups
  for each row execute function public.guard_group_sync_trip_removal();

revoke all on function public.apply_group_trip_sync_change(uuid,text,text,text,jsonb,bigint,uuid) from public,anon;
grant execute on function public.apply_group_trip_sync_change(uuid,text,text,text,jsonb,bigint,uuid) to authenticated;

do $$
begin
  if exists (select 1 from pg_publication where pubname='supabase_realtime')
    and not exists (select 1 from pg_publication_tables where pubname='supabase_realtime'
      and schemaname='public' and tablename='group_sync_events') then
    alter publication supabase_realtime add table public.group_sync_events;
  end if;
end;
$$;

comment on table public.group_trip_sync_state is 'App-ID keyed shared cover and settlement state with independent cover revision, separate from legacy JSON snapshots.';
comment on table public.group_trip_sync_photos is 'Shared TripPhoto metadata and private storage key; no local URI or signed URL.';
comment on table public.group_trip_sync_expenses is 'Versioned app-ID keyed expenses; deleted rows remain as tombstones.';
comment on table public.group_sync_events is 'Minimal, revision-ordered invalidation events; payloads contain no photo location or URL.';
comment on trigger groups_guard_sync_trip_removal on public.groups is
  'Prevents a snapshot replacement or existing trip-delete RPC from removing a trip with live synchronized entities.';
comment on function public.apply_group_trip_sync_change(uuid,text,text,text,jsonb,bigint,uuid) is
  'Atomic idempotent sync command; active group membership, trip existence, entity version and expense role checks precede mutation. Settlement entity ID is trip ID.';
comment on function public.load_group_trip_sync_snapshot(uuid,text) is
  'Returns one active member trip sync snapshot, including group revision and all entities from one MVCC view.';
notify pgrst, 'reload schema';

-- Permit an owner to retry an upload to the same private group-trip photo key.
-- Keep both the existing row and replacement row bound to the active member,
-- the exact {group UUID}/{trip ID}/{photo ID} path, and the authenticated owner.
create policy moyeogo_trip_photo_objects_update_owner_active
on storage.objects for update to authenticated
using (
  bucket_id = 'moyeogo-trip-photos'
  and owner_id = (select auth.uid())::text
  and cardinality(storage.foldername(name)) = 2
  and (storage.foldername(name))[2] ~ '^[A-Za-z0-9_-]{1,128}$'
  and storage.filename(name) ~ '^[A-Za-z0-9_-]{1,128}$'
  and exists (
    select 1 from public.group_members gm
    where gm.group_id::text = (storage.foldername(name))[1]
      and gm.user_id = (select auth.uid())
      and gm.status = 'active'
  )
  and not exists (
    select 1 from public.group_trip_sync_photos p
    where p.storage_key = name and p.deleted_at is not null
  )
)
with check (
  bucket_id = 'moyeogo-trip-photos'
  and owner_id = (select auth.uid())::text
  and cardinality(storage.foldername(name)) = 2
  and (storage.foldername(name))[2] ~ '^[A-Za-z0-9_-]{1,128}$'
  and storage.filename(name) ~ '^[A-Za-z0-9_-]{1,128}$'
  and exists (
    select 1 from public.group_members gm
    where gm.group_id::text = (storage.foldername(name))[1]
      and gm.user_id = (select auth.uid())
      and gm.status = 'active'
  )
  and not exists (
    select 1 from public.group_trip_sync_photos p
    where p.storage_key = name and p.deleted_at is not null
  )
);

comment on policy moyeogo_trip_photo_objects_update_owner_active on storage.objects is
  'Allows only the active owning account to replace a photo object within its exact group/trip/photo path while its photo metadata is not tombstoned.';

-- Permit an uploader to retry an orphaned private photo upload with upsert.
-- This is limited to an exact group/trip/photo key with no registered metadata.
create policy moyeogo_trip_photo_objects_select_owner_orphan_active
on storage.objects for select to authenticated using (
  bucket_id = 'moyeogo-trip-photos'
  and owner_id = (select auth.uid())::text
  and cardinality(storage.foldername(name)) = 2
  and name ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[A-Za-z0-9_-]{1,128}/[A-Za-z0-9_-]{1,128}$'
  and (storage.foldername(name))[2] ~ '^[A-Za-z0-9_-]{1,128}$'
  and storage.filename(name) ~ '^[A-Za-z0-9_-]{1,128}$'
  and exists (
    select 1 from public.group_members gm
    where gm.group_id::text = (storage.foldername(name))[1]
      and gm.user_id = (select auth.uid())
      and gm.status = 'active'
  )
  and not exists (
    select 1 from public.group_trip_sync_photos p
    where p.storage_key = name
  )
);

comment on policy moyeogo_trip_photo_objects_select_owner_orphan_active on storage.objects is
  'Allows only the active owning account to select its exact unregistered photo key for upsert retry.';

-- Hide tombstones from direct authenticated reads while retaining them for the
-- SECURITY DEFINER sync RPC's version and idempotency handling.
drop policy group_trip_sync_photos_read_active on public.group_trip_sync_photos;
create policy group_trip_sync_photos_read_active on public.group_trip_sync_photos
  for select to authenticated
  using (public.is_group_member(group_id) and deleted_at is null);

drop policy group_trip_sync_expenses_read_active on public.group_trip_sync_expenses;
create policy group_trip_sync_expenses_read_active on public.group_trip_sync_expenses
  for select to authenticated
  using (public.is_group_member(group_id) and deleted_at is null);

-- Storage paths are exactly {public group UUID}/{app trip ID}/{app photo ID}.
-- client_snapshot stores trips at {group,trips}, each with its app ID in `id`.
drop policy moyeogo_trip_photo_objects_insert_active on storage.objects;
create policy moyeogo_trip_photo_objects_insert_active on storage.objects
  for insert to authenticated with check (
    bucket_id = 'moyeogo-trip-photos'
    and cardinality(storage.foldername(name)) = 2
    and name ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[A-Za-z0-9_-]{1,128}/[A-Za-z0-9_-]{1,128}$'
    and (storage.foldername(name))[2] ~ '^[A-Za-z0-9_-]{1,128}$'
    and storage.filename(name) ~ '^[A-Za-z0-9_-]{1,128}$'
    and exists (
      select 1
      from public.group_members gm
      join public.groups g on g.id = gm.group_id
      where gm.group_id::text = (storage.foldername(name))[1]
        and gm.user_id = (select auth.uid())
        and gm.status = 'active'
        and jsonb_typeof(g.client_snapshot #> '{group,trips}') = 'array'
        and exists (
          select 1
          from jsonb_array_elements(
            case
              when jsonb_typeof(g.client_snapshot #> '{group,trips}') = 'array'
                then g.client_snapshot #> '{group,trips}'
              else '[]'::jsonb
            end
          ) trip(value)
          where trip.value ->> 'id' = (storage.foldername(name))[2]
        )
        and not exists (
          select 1 from public.group_trip_sync_photos p
          where p.group_id = gm.group_id
            and p.trip_client_id = (storage.foldername(name))[2]
            and p.photo_client_id = storage.filename(name)
            and p.storage_key = name
            and p.deleted_at is not null
        )
    )
  );

comment on policy moyeogo_trip_photo_objects_insert_active on storage.objects is
  'Allows active group members to insert private photo objects only at an exact group/trip/photo path for a trip present in the group client snapshot, unless that exact photo ID is tombstoned.';

-- Rollback restores the former active-member-only predicates for the three
-- replaced policies. This intentionally restores tombstone visibility and
-- unrestricted descendant keys, so it also restores the reported exposure.

-- Allow Storage cleanup only after photo.delete has committed its metadata tombstone.
-- The existing delete policy allowed uploaders and owners to remove live objects.
drop policy moyeogo_trip_photo_objects_delete_active on storage.objects;

create policy moyeogo_trip_photo_objects_delete_active on storage.objects
  for delete to authenticated using (
    bucket_id = 'moyeogo-trip-photos'
    and cardinality(storage.foldername(name)) = 2
    and name ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[A-Za-z0-9_-]{1,128}/[A-Za-z0-9_-]{1,128}$'
    and (storage.foldername(name))[2] ~ '^[A-Za-z0-9_-]{1,128}$'
    and storage.filename(name) ~ '^[A-Za-z0-9_-]{1,128}$'
    and exists (
      select 1
      from public.group_members gm
      join public.groups g on g.id = gm.group_id
      where gm.group_id::text = (storage.foldername(name))[1]
        and gm.user_id = (select auth.uid())
        and gm.status = 'active'
        and g.client_snapshot #>> '{group,id}' = coalesce(g.client_group_id, g.id::text)
        and exists (
          select 1
          from public.group_trip_sync_photos p
          where p.group_id = gm.group_id
            and p.trip_client_id = (storage.foldername(name))[2]
            and p.photo_client_id = storage.filename(name)
            and p.storage_key = name
            and p.deleted_at is not null
            and (
              p.added_by_user_id = (select auth.uid())
              or g.owner_user_id = (select auth.uid())
            )
        )
    )
  );

comment on policy moyeogo_trip_photo_objects_delete_active on storage.objects is
  'Allows an active uploader or group owner to delete only the exact Storage object whose photo metadata is tombstoned in the matching group; permits retry after trip snapshot removal.';

-- Rollback: drop this policy and recreate the original policy from
-- 202610240001_group_trip_sync_commands.sql. Doing so restores direct deletion
-- of live photo objects by active uploaders and group owners.

COMMIT;

