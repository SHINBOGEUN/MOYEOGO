# Apply trip audit migrations

- **Status:** applied and postflight verified in Supabase SQL Editor; live history display remains unverified
- **Lead role / owner:** coordinator / Codex
- **Execution:** delegated review; coordinator verifies and applies through the Supabase SQL Editor
- **Assigned agents:** backend-data reviewer: inspect migrations `202610250001` and `202610250002` for ordering, privacy, data impact, transactional safety, grants/RLS, prerequisites, and failure behavior; QA reviewer: independently inspect the API contract and migration acceptance risks. Both are review-only and must not access the remote database or edit files.
- **Related goal/decision/history:** `docs/PRODUCT_GOAL_V1.md`; audit decisions in `docs/DECISIONS.md`; entries 97–98 in `docs/PRODUCT_HISTORY.md`; Supabase application notes in `docs/SUPABASE_SETUP.md`
- **Files owned by this task:** backend reviewer owns review only of the two SQL migrations; QA reviewer owns review only of the audit DTO/API and migration contract; coordinator owns this task note and any application-state documentation.

## Request and reason

The user supplied instructions to confirm whether these migrations have already been applied and, if not, run `202610250001_group_trip_change_audit.sql` followed by `202610250002_group_expense_audit_read_api.sql` through the Supabase SQL Editor. The private audit history stores expense and settlement before/after details and exposes a limited active-member read API.

## Acceptance criteria

- [x] Independent backend-data and QA reviews passed after fixing the delete after-state projection.
- [x] Read-only remote preflight confirmed project `myg` and that both migrations' objects are absent; the 2026-10-24 sync prerequisites exist.
- [x] User ran both migrations in order, once, as one transaction through SQL Editor. Never use `supabase db push`.
- [x] Read-only postflight confirms audit table, triggers, RPC signature and grants/RLS, and index.
- [x] Updated current setup and decision documents; recorded the result and verification limits in product history.
- [x] No test trip, expense, or settlement data was created or altered.

## Relevant context

- SQL: `supabase/migrations/202610250001_group_trip_change_audit.sql`, `supabase/migrations/202610250002_group_expense_audit_read_api.sql`
- App/API: `src/data/remoteGroupExpenseAudit.ts`, `src/data/remoteGroupActivity.ts`, `App.tsx`
- Roles and procedures: `docs/agents/roles/backend-data/ROLE.md`, `docs/agents/roles/qa-review/ROLE.md`, `.agents/skills/qa-review/SKILL.md`

## Review and preflight

The first QA review found that `expense.delete` would render identical before/after summaries. Migration 002 now returns null after-snapshot columns for `expense.delete`; the DTO maps this to a missing after snapshot and the activity UI renders only the before state. The QA and backend-data reviewers rechecked this fix and found no remaining blocker. Read-only SQL Editor preflight on 2026-10-25 returned `auditTableExists=false`, `auditRpcExists=false`, `indexExists=false`, no audit triggers, and confirmed the required event/expense/state sync tables exist. Both migrations were absent at preflight and have since been applied.

The user ran the combined transaction at `supabase/manual_apply_trip_audit_20261025.sql` in the authenticated SQL Editor. Postflight against `myg` (`lucgrjuewvvpgmdzjeys`) confirmed `group_sync_event_audit` exists with RLS enabled and no authenticated SELECT/INSERT/UPDATE/DELETE grant; the expense, settlement, and event audit triggers are enabled; `list_group_expense_audit(uuid,text,integer,text)` is STABLE SECURITY DEFINER and executable by `authenticated` only (denied to `anon` and `public`); internal trigger functions are not executable by app roles; the audit index exists; and direct authenticated event INSERT/UPDATE/DELETE remain denied. The app's “최근 변경 이력” screen is already wired to the RPC, but its live query/display has not been tested. No test trip, expense, or settlement rows were created. SQL Editor does not update CLI migration history; reconcile it before any `supabase db push`.
