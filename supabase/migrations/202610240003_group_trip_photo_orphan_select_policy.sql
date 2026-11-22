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
