# Fix create_group_trip variable collision

- **Status:** complete; migration applied and postflight verified; live app creation pending
- **Lead role / owner:** coordinator / Codex
- **Execution:** delegated review, coordinator applies migration
- **Assigned agents:** backend-data reviewer: inspect migration 005 against installed 002 contract and report SQL/runtime safety; QA reviewer: independently inspect changed function behavior and acceptance criteria. Review-only; no edits.
- **Related goal/decision/history:** `docs/PRODUCT_GOAL_V1.md`; shared trip creation decision in `docs/DECISIONS.md`; `docs/PRODUCT_HISTORY.md` entries 88–89
- **Files owned by this task:** migration review only `supabase/migrations/202610220005_create_group_trip_variable_collision_fix.sql`; QA review only `App.tsx`, `src/data/remoteGroups.ts`, and migration 005; coordinator owns this task note and documentation.

## Request and reason

Fix the ambiguous `trip_client_id` reference in the installed `create_group_trip` database function. Keep migration 002 unchanged and apply the follow-up migration if review and preflight pass.

## Acceptance criteria

- [x] Independently review migration 005 for function contract, privileges, idempotency, and safe replacement behavior.
- [x] Confirm the selected remote project is `myg` (`lucgrjuewvvpgmdzjeys`) and current function exists before applying.
- [x] Apply only migration 005 once through Supabase SQL Editor.
- [x] Verify the installed function body uses a distinct variable name and preserves signature, grants, and expected RPC contract.
- [x] Run relevant checks; record whether a live trip creation was tested (do not create test data without need).
- [x] Update setup, decisions/history, and this note with results and CLI migration-history caveat.

## Handoff

Backend-data and QA reviewers found no actionable issue in migration 005. Preflight confirmed the expected `myg` project, installed `create_group_trip(uuid,jsonb)`, the idempotency table, authenticated execution, and denied anonymous execution. Applied only migration 005 in a transaction on 2026-10-22; migration 002 was not rerun. Postflight confirmed the new `v_trip_client_id` declaration and qualified key lookup, preserved `SECURITY DEFINER`, signature, grants, and response/notification contract. `npm run check` passed TypeScript and 29 tests. No live trip was created, so test in the app. QA identified a separate potential duplicate risk if a successful server request loses its response and the client retries using a new trip ID; that is outside this SQL fix. SQL Editor does not add CLI migration history; reconcile before `supabase db push`.
