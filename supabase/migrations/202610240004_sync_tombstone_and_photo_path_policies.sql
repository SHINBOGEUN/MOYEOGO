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
