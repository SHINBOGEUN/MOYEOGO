# Task: Edit an existing friend group

- **Status:** complete
- **Lead role / owner:** coordinator / Codex
- **Execution:** delegated
- **Assigned agents:** `mobile-engineering` owns `App.tsx`, `src/domain/groupEditing.ts`, and focused tests; `qa-review` independently reviews the final flow without editing it. The coordinator owns documentation and integration.
- **Related goal/decision/history:** [`../PRODUCT_GOAL_V1.md`](../PRODUCT_GOAL_V1.md) group management and settlement; [`../DECISIONS.md`](../DECISIONS.md) group membership and saved member order.
- **Files owned by this task:** `App.tsx`, `src/domain/groupEditing.ts`, focused test scripts, `docs/DECISIONS.md`, `docs/PRODUCT_HISTORY.md`, this note.

## Request and reason

The owner made a group and cannot edit it afterward. Add an edit entry from group details so an incorrect name or member list can be corrected without recreating the group and losing trips.

## Acceptance criteria

- [x] From an existing group, open an edit form prefilled with its name and members; cancel/back leaves the saved group unchanged.
- [x] Rename the group and non-owner members, add a guest or selected app friends, and remove eligible non-owner members. Keep the creator first and non-removable, require at least one other member, and reject blank/duplicate names using creation rules.
- [x] Preserve IDs and order for retained members, and preserve the group's ID and all trips/expenses/photos/settlement records. Append new members with new IDs; do not silently recalculate or clear settlement state.
- [x] Block removing any member referenced as a trip treasurer, expense payer, or expense participant, with a clear explanation. Never leave a dangling member ID in a trip.
- [x] Save to the existing account-local store; reopening and app relaunch show the edits. Existing group creation and trip flows still work.
- [x] `npm run check` passes, and Android emulator edit flow is checked.

## Relevant context

- Current create UI and group detail: `App.tsx`; `Group`/`Trip` types: `src/domain/models.ts`; member and settlement rules: `src/domain/settlement.ts`; account-local persistence: `src/data/groupStore.ts`.
- A member's saved position determines rounding and tied minimum-transfer results, so retained IDs and order must stay stable.

## Handoff

Implementation: `App.tsx` adds the group-detail edit entry and prefilled form. `src/domain/groupEditing.ts` validates edits and preserves the existing group, member references, and trip records. `scripts/group-editing.test.mjs` covers name/member edits and rejected referenced-member removal.

Validation: `npm run check` passed (TypeScript and 27 tests). Android emulator created a temporary group, opened the edit screen, renamed it, saved, restarted the app, and showed the new name in the group list. The emulator's original SQLite data was restored after the test. Independent QA review reported no actionable findings; it did not perform a second emulator UI run.
