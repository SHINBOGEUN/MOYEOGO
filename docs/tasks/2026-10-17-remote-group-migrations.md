# Task: Apply remote group lifecycle migrations

- **Status:** migrations applied; device flow verification pending
- **Lead role / owner:** coordinator / Codex
- **Execution:** dashboard SQL Editor, with independent read-only migration review and QA review
- **Target:** Supabase project `myg`, ref `lucgrjuewvvpgmdzjeys`
- **Approval:** User approved applying both named migration files in order after reviewing the permanent group deletion behavior.
- **Related files:** [`../../supabase/migrations/202610160001_remote_group_snapshots_and_friend_invites.sql`](../../supabase/migrations/202610160001_remote_group_snapshots_and_friend_invites.sql), [`../../supabase/migrations/202610170001_remote_group_lifecycle_and_notifications.sql`](../../supabase/migrations/202610170001_remote_group_lifecycle_and_notifications.sql), [`../SUPABASE_SETUP.md`](../SUPABASE_SETUP.md), [`../DECISIONS.md`](../DECISIONS.md).

## Preflight

- Verified the Supabase dashboard project ref was `lucgrjuewvvpgmdzjeys` (`myg`, `main`).
- Read-only queries found the base `groups`, `group_members`, `trips`, and `friend_requests` tables.
- Before applying, the snapshot columns and `group_member_invitations` / `group_notifications` tables were absent.
- `supabase_migrations.schema_migrations` was absent; Dashboard SQL Editor execution therefore does not create CLI migration history.
- Independent review found the migrations ordered correctly and confirmed that applying them does not delete existing business rows. Calling the owner-only delete RPC later permanently removes the selected group's trips and dependent expense/settlement records.

## Applied and checked

- Applied `202610160001_remote_group_snapshots_and_friend_invites.sql` once: `Success. No rows returned`.
- Applied `202610170001_remote_group_lifecycle_and_notifications.sql` once: `Success. No rows returned`.
- Read-only postflight passed: invitation and notification tables exist; all four snapshot/member columns exist; all seven expected RPCs exist; authenticated can execute and anon cannot; the old direct owner-delete policy is absent; notification RLS is enabled.
- The SQL applies globally; per-user database constraints and RPC ownership checks are in place. End-to-end app flows with two accounts are not yet verified.
- Do not rerun either non-idempotent SQL file. Reconcile CLI migration history before a future `supabase db push`.
