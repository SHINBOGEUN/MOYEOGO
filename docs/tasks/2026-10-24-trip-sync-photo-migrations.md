# Apply remote trip synchronization and photo policy migrations

- **Status:** applied and postflight verified in Supabase SQL Editor; real two-device behavior still needs runtime verification
- **Lead role / owner:** coordinator / Codex
- **Execution:** delegated review; coordinator performs dashboard migration application
- **Assigned agents:** backend-data reviewer: inspect the five SQL migrations for ordering, data impact, transactional safety, grants/RLS/storage path security, and prerequisites; QA reviewer: independently inspect app contracts and migration acceptance risks. Both are review-only and must not access the remote database or edit files.
- **Related goal/decision/history:** `docs/PRODUCT_GOAL_V1.md`; sync/photo/privacy decisions in `docs/DECISIONS.md`; migration guidance in `docs/SUPABASE_SETUP.md`
- **Files owned by this task:** backend reviewer owns review only of migrations `202610240001`–`202610240005`; QA reviewer owns review only of `src/data/remoteGroups.ts`, trip/photo sync call sites in `App.tsx`, and migration contracts; coordinator owns this task note and documentation.

## Request and reason

Apply the five prepared migrations that add shared trip entity synchronization and repair private photo storage policies for account members using the same remote group across devices. Do not use `supabase db push`; the project has prior Dashboard-applied migration history that must be reconciled before CLI deployment.

## Acceptance criteria

- [x] Independent backend-data and QA reviews found no unresolved blocking issue after fixing the snapshot race, cover-photo deletion, repeat photo tombstones, and tombstoned Storage path reuse.
- [x] Read-only remote preflight confirmed project `myg` (`lucgrjuewvvpgmdzjeys`), required prerequisites, and absence of migrations 001–005 objects/policies. There were no pre-existing Storage DELETE policies.
- [x] Owner ran the five migrations in order as the combined transaction through Supabase SQL Editor. Do not rerun them.
- [x] Read-only postflight confirms sync tables/functions, RLS/grants, private photo bucket, photo policies, Realtime publication, and trip-removal guard.
- [x] `npm run check` passed TypeScript and 48 tests. No real trip/photo/expense data was created. Live multi-device sync remains unverified.
- [x] Setup and decision notes record the applied state, remaining device-test limitation, and CLI history caveat.

## Application and postflight

After the owner confirmed running the bundle, a read-only postflight query against project `myg` (`lucgrjuewvvpgmdzjeys`) returned all six expected sync tables; both SECURITY DEFINER RPCs with authenticated execution and anonymous denial; RLS enabled on all six tables with no authenticated write grants; the private 20 MiB photo bucket with the expected image MIME types; four public SELECT policies; five Storage policies covering SELECT/INSERT/UPDATE/DELETE and orphan reads; Realtime publication for `group_sync_events`; and the trip-removal guard trigger. The SQL editor reported success for the transaction. Do not rerun the bundle or individual migrations.

`npm run check` passed TypeScript and 48 tests before application. No real trip/photo/expense data was created. Two-device runtime synchronization remains unverified. SQL Editor application does not update CLI migration history; reconcile manually applied versions before any `supabase db push`.
