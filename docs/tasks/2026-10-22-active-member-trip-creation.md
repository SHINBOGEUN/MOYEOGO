# Active-member trip creation and notifications

- **Status:** complete; app contract connected and remote migration applied/verified; two-account live test pending
- **Lead / role:** DB agent
- **Execution:** backend-data reviewer and QA reviewer ran independent read-only reviews; Codex owns app/migration integration and remote SQL apply
- **Files:** `supabase/migrations/202610220002_active_member_trip_creation_notifications.sql`, `src/data/remoteGroups.ts`, `App.tsx`, `docs/SUPABASE_SETUP.md`, `docs/PRODUCT_HISTORY.md`

## Request

Allow an authenticated active account member to add one trip to the shared app snapshot and notify every other active account member in the same group. Keep `save_group_snapshot` owner-only. Do not rerun or edit previously applied migrations. The product owner now requests applying the new follow-up migration only, after the UUID response contract is connected and reviewed.

## Agreed API contract

- `create_group_trip(requested_group_id uuid, requested_trip jsonb) returns jsonb`
- `requested_group_id` is `groups.id`; the trip ID is the app snapshot's text ID.
- New result: `{groupId, groupDbId, tripId, tripName, created: true}`. An identical retry by the same creator returns the existing trip with `created: false`.
- The RPC rejects ID reuse with a different payload, non-member/inactive callers, invalid trip data or dates, and client-supplied lifecycle timestamps.
- The RPC creates recipient-only `trip_created` rows for other active account members in the same transaction. Existing `list_my_group_notifications` already returns `type`, `groupId`, `groupDbId`, `tripId`, and `tripName`.
- `group_notifications` is added to the Realtime publication with authenticated SELECT grant and RLS restricted to `recipient_user_id = auth.uid()`. The app must subscribe to INSERT events with its signed-in user ID and then reload the existing recipient-only list RPC.

## Acceptance criteria

- [x] New migration follows `202610220001`; prior migrations are untouched.
- [x] Dedicated RPC locks the group, checks active membership, validates one app trip and the date range, and appends atomically.
- [x] Duplicate IDs are rejected unless the same creator retries the identical creation payload; retry does not update the snapshot or add notices.
- [x] Server-managed lifecycle timestamps cannot be set by the request; the existing snapshot trigger remains in force.
- [x] Notices target only other active account members and retain the existing recipient-only list/RLS model.
- [x] Realtime publication is added with a recipient-only SELECT policy; no other role gains table access.
- [x] `list_my_group_snapshots` includes the database UUID as `groupDbId`, and the app's `RemoteGroup` contract and caller consume it.
- [x] Independently review the final migration and client contract; no actionable issues were found by backend-data and QA reviewers.
- [x] Read-only remote preflight confirmed all prerequisites and that the follow-up migration had not already been applied.
- [x] With owner approval, apply this new migration once and verify schema/function/policy/publication state without generating test trips or notifications.
- [x] Run `npm run check`; two-account realtime behavior remains untested.

## Rollback and compatibility

The schema additions can be removed in a rollback migration, but after the RPC is used the trip snapshots and notification rows are product data and are not automatically reversible. Removing `group_trip_creation_keys` also removes durable idempotency history. The migration adds no backfill and leaves existing trip snapshots, notification rows, `save_group_snapshot`, and its startedAt trigger unchanged. The notification type constraint is rebuilt to include every type present in the latest local migration plus `trip_created`.

## Verification limits

The user requested remote application after a previous QA report identified the missing `groupDbId` response contract. The migration now adds `groupDbId` to `list_my_group_snapshots`; `RemoteGroup` exposes the field and App consumes it without an unsafe optional-type cast. The applied baseline `202610220001` was left untouched. Preflight confirmed expected tables/columns and that the new RPC and idempotency table were absent. Postflight on 2026-10-22 confirmed all intended functions, grants, RLS, constraints, and Realtime publication; the `trip_created` row count remained zero. SQL Editor does not create CLI migration history, so reconcile it before a later `supabase db push`. No real trip or notification was generated; two-account/device behavior remains to test.
