# Apply trip-start confirmation migration

- **Status:** database migration applied and postflight verified; app/device QA remains
- **Lead role / owner:** coordinator / Codex
- **Execution:** delegated
- **Assigned agents:** backend-data review (read-only migration safety, stop after report); qa-review (independent read-only contract and regression review, stop after report)
- **Related goal/decision/history:** [`PRODUCT_GOAL_V1.md`](../PRODUCT_GOAL_V1.md); [`DECISIONS.md`](../DECISIONS.md), trip lifecycle decision
- **Files owned by this task:** coordinator owns this task note and any final documentation updates; agents do not edit files; migration is read-only for review

## Request and reason

The product owner asked to apply the local trip-start confirmation migration to the linked Supabase project. The prior report says the migration has not been applied and the app should prompt an active account member to confirm before starting a due trip.

## Acceptance criteria

- [x] Confirm the target Supabase project and inspect remote schema/functions/schedule before mutation.
- [x] Review the migration for data, access-control, and scheduling risks; no material issue remained after the fixes and independent reviews.
- [x] Apply missing prerequisites `202610180001` and `202610190001` in order, then `202610220001_trip_start_prompt_flow.sql` once.
- [x] Enable `pg_cron` and register the approved 15-minute prompt-generation job.
- [x] Verify the new constraint, trigger, RPCs, grants, and scheduler state without starting trips or creating test notifications.
- [x] Record the confirmed remote outcome and remaining app-flow/test limitations.

## Relevant context

- Migration: [`202610220001_trip_start_prompt_flow.sql`](../../supabase/migrations/202610220001_trip_start_prompt_flow.sql)
- Prior auto-start migration: [`202610190001_auto_start_group_trips.sql`](../../supabase/migrations/202610190001_auto_start_group_trips.sql)
- Supabase project expected from existing setup: `myg` / `lucgrjuewvvpgmdzjeys`

## Handoff

Remote preflight confirmed project `myg` / `lucgrjuewvvpgmdzjeys`, and showed migrations `202610180001` and `202610190001` were absent. Independent backend and QA reviews found no remaining material issue after the local patch to retire stale prompts and ignore inactive jobs. On 2026-10-22, `202610180001`, `202610190001`, and `202610220001` each returned `Success. No rows returned` in Supabase SQL Editor; `pg_cron` was enabled with the user's approval. Postflight JSON confirmed `read_at`, `trip_client_id`, `trip_name`, `started_at`, a validated notification-type constraint, enabled timestamp-preservation trigger, prompt/start RPC presence and expected grants, and active job `moyeogo-trip-start-prompts` on `*/15 * * * *` calling `create_due_trip_start_prompts()`. Immediate job-history lookup returned zero rows and there were 0 existing `trip_started` notice rows. No trip start or test prompt was triggered. App/device behavior remains untested. SQL Editor does not write `supabase_migrations.schema_migrations`; reconcile the CLI migration history before using `supabase db push`.
