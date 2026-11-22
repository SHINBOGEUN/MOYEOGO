# Task: Apply group invitation notification migration

- **Status:** done; migration applied and postflight passed; device flow verification remains pending
- **Lead role / owner:** coordinator / Codex
- **Execution:** delegated
- **Assigned agents:** backend-data read-only SQL safety review; qa-review independent read-only review; both stop after reporting findings and do not edit files
- **Related goal/decision/history:** [`../DECISIONS.md`](../DECISIONS.md) group invitation notification decision; [`../PRODUCT_HISTORY.md`](../PRODUCT_HISTORY.md) entries 76–77
- **Files owned by this task:** Supabase project `myg` (`lucgrjuewvvpgmdzjeys`) remote SQL state; this task note and related setup/decision/history docs

## Request and reason

Apply `202610170002_remote_group_invitation_notifications.sql` to the user's Supabase project so invited accounts receive an in-app invitation notice and group creators receive an acceptance notice.

## Acceptance criteria

- [x] Confirm the SQL Editor is connected to the expected Supabase project.
- [x] Verify prerequisites and that the migration has not already been applied or partially applied.
- [x] Run this migration exactly once, without rerunning `202610160001` or `202610170001`.
- [x] Verify the new schema objects and updated RPC behavior contract after execution.
- [x] Record whether the database update succeeded; distinguish schema verification from end-to-end device testing.

## Relevant context

- [`../../supabase/migrations/202610170002_remote_group_invitation_notifications.sql`](../../supabase/migrations/202610170002_remote_group_invitation_notifications.sql)
- [`../DECISIONS.md`](../DECISIONS.md)
- [`../SUPABASE_SETUP.md`](../SUPABASE_SETUP.md)
- Existing migrations `202610160001` and `202610170001` were applied and verified on 2026-10-17.

## Handoff

- SQL Editor visibly targets project `myg`, ref `lucgrjuewvvpgmdzjeys`.
- Read-only preflight found all required group, member, invitation, and notification columns; the existing type constraint is exactly `notification_type = 'member_left'`.
- The `invitation_id` column and invitation trigger are absent, so the migration is not already fully applied. The two previously applied migrations were not rerun.
- Independent backend-data and QA reviews found no immediate access-control issue; both warn this SQL is non-idempotent and should not be retried blindly after a partial failure. It backfills recipient-scoped notifications for eligible pending invitations and does not delete group/trip data.
- Applied `202610170002_remote_group_invitation_notifications.sql` once in the SQL Editor for `myg` (`lucgrjuewvvpgmdzjeys`): `Success. No rows returned`.
- Postflight verified the UUID invitation column and FK, notification type constraint, partial unique index, trigger and security-definer function, authenticated-only execution for acceptance/list RPCs, notifications RLS, and one eligible pending invite with exactly one invitation notice.
- Independent backend-data and QA reviews found no immediate access-control issue. Do not rerun this non-idempotent migration; inspect state carefully if any later error suggests partial execution.
- No two-account app interaction was performed. Verify invite visibility, acceptance, creator notice, idempotent retry, guest behavior, and unauthorized-account denial in a later device smoke test.
- SQL Editor application does not add CLI migration history; reconcile it before future `supabase db push`.
