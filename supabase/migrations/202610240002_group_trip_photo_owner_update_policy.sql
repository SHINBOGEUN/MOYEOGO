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
