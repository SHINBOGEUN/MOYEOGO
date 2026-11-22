# Owner-only trip deletion and tombstones

- **Status:** complete; both migrations applied atomically and postflight verified; live app test pending
- **Lead role / owner:** coordinator / Codex
- **Execution:** delegated
- **Assigned agents:** backend-data reviewer: read-only review of migrations `202610220003` and `202610220004`, SQL safety and ordering; QA reviewer: read-only review of the app deletion path and its contract against both migrations. No file edits; report actionable findings and stop.
- **Related goal/decision/history:** `docs/DECISIONS.md` shared trips; existing remote-trip behavior and migration history in `docs/SUPABASE_SETUP.md`
- **Files owned by this task:** review only `App.tsx`, `src/data/remoteGroups.ts`, `supabase/migrations/202610220003_owner_delete_group_trip.sql`, `supabase/migrations/202610220004_group_trip_delete_tombstones.sql`; coordinator owns this task note and setup/history/decision updates.

## Request and reason

The product owner requests applying the two pending owner-only trip-deletion migrations after a report found two data-loss risks: allowing deletion when the expenses field is missing/unverifiable, and stale snapshots restoring a previously deleted trip.

## Acceptance criteria

- [x] Independently review both migrations and the client flow; resolve any material finding before remote changes.
- [x] Read-only preflight confirms `003` is not already applied, `004` is not partially applied, prerequisites exist, and the selected Dashboard is project `myg` (`lucgrjuewvvpgmdzjeys`).
- [x] After review and preflight pass, apply `003` then `004` once in one transaction through Supabase SQL Editor; do not rerun older migrations.
- [x] Read-only postflight verifies owner-only RPC grants, fail-closed expense validation, tombstone table privacy/RLS, trigger attachment, and the replacement delete RPC.
- [x] Do not delete real trip data as a test. Run relevant app checks and record device/E2E limits.
- [x] Update setup, decisions/history, and this note with exact results and CLI migration-history caveat.

## Relevant context

- `supabase/migrations/202610220003_owner_delete_group_trip.sql`
- `supabase/migrations/202610220004_group_trip_delete_tombstones.sql`
- `App.tsx`, `src/data/remoteGroups.ts`
- `.agents/skills/qa-review/SKILL.md`
- `docs/agents/roles/backend-data/ROLE.md`, `docs/agents/roles/qa-review/ROLE.md`

## Handoff

The client exposes trip deletion only to the owner, only with a loaded remote snapshot, and reloads canonical remote state after an RPC success. Migration `003` introduces the owner-only RPC; `004` replaces it with fail-closed expense checks and adds tombstones plus a snapshot filter trigger. Backend-data and QA reviewers found no remaining actionable issues; backend review required that both SQL files run as one transaction because `003` alone permits unverifiable expense state. Preflight confirmed the baseline was clean. The two files were applied in order in one transaction on 2026-10-22. Postflight confirmed authenticated-only RPC execution, fail-closed expense checks, private tombstone RLS/grants, the snapshot filter trigger, and preservation of the startedAt trigger. `npm run check` passed TypeScript and 29 tests. No real trip was deleted. Live device, stale-client, and concurrent-save behavior remains unverified. SQL Editor does not record CLI migration history; reconcile before a later `supabase db push`.
