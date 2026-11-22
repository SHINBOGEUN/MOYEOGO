# Apply trip activity details migration

- **Status:** done
- **Lead role / owner:** backend-data / Codex
- **Execution:** delegated
- **Assigned agents:** backend SQL reviewer (read-only review of migration semantics/security); QA reviewer (independent acceptance and privacy review; no edits)
- **Related goal/decision/history:** `docs/DECISIONS.md` activity feed decision; `docs/PRODUCT_HISTORY.md` 2026-10-25 trip activity details request
- **Files owned by this task:** migration review target `supabase/migrations/202610250003_group_trip_activity_details.sql`; task record and Supabase setup/application status owned by lead

## Request and reason

The product owner explicitly asked to apply `202610250003_group_trip_activity_details.sql` to the existing `myg` Supabase project. The migration replaces the trip activity RPC so active members can view a bounded activity page with expense title and whole-KRW amount for expense creation events.

## Acceptance criteria

- [x] Review migration and verify prerequisites/current remote state before execution.
- [x] Apply only if the exact migration is not already installed and checks pass.
- [x] Verify RPC definition, grants, and bounded active-member/trip access after execution.
- [x] Record the confirmed result in Supabase setup and decision/history sources.

## Relevant context

- `supabase/migrations/202610250003_group_trip_activity_details.sql`
- Prior activity audit migrations `202610250001` and `202610250002` were applied to `myg` on 2026-10-25.
- `docs/SUPABASE_SETUP.md` notes manual SQL Editor application does not update CLI migration history.

## Handoff

Independent SQL and QA reviews found no blocking issues. Read-only preflight found the RPC absent and the audit table present. The user authorized this exact migration; it was run once in a transaction. Postflight confirmed RPC security mode and grants, active-member/current-trip checks, bounded pagination, audit-table RLS, and no direct authenticated/anon audit-table SELECT. Runtime app display remains unverified. SQL Editor does not update CLI migration history.
