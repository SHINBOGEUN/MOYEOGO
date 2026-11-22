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
