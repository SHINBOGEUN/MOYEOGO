# Task: 실행 가능한 에이전트 작업 하네스

- **Status:** done
- **Lead role / owner:** coordinator / Codex
- **Execution:** delegated
- **Assigned agents:** qa-review / read-only review of the dispatch rules, validation command, and third navigation design; no file edits; stop after findings report
- **Related goal/decision/history:** [`AI_WORKFLOW.md`](../AI_WORKFLOW.md), [`PRODUCT_HISTORY.md`](../PRODUCT_HISTORY.md)
- **Files owned by this task:** lead owns `AGENTS.md`, `docs/AI_WORKFLOW.md`, `docs/tasks/TASK_TEMPLATE.md`, `scripts/harness-check.mjs`, `package.json`, `README.md`, and product notes; QA owns no files

## Request and reason

The owner expected the project's role Markdown files to make agents participate in work. Explain the difference between role instructions and a live execution harness, then connect explicit delegation rules and repeatable checks so the documents are used honestly.

## Acceptance criteria

- [x] A focused UI change can stay with one agent; multi-role or high-risk work names and dispatches bounded subagents when available.
- [x] A task note identifies agent assignments, acceptance criteria, file boundaries, and handoff.
- [x] `npm run check` runs TypeScript and the existing unit tests without relying on a shell glob.
- [x] Independent read-only QA reports findings or confirms the inspected scope.
- [x] The final response states which agents actually ran and the limits of Markdown-only orchestration.

## Relevant context

- [`AGENTS.md`](../../AGENTS.md), [`AI_WORKFLOW.md`](../AI_WORKFLOW.md), [`TASK_TEMPLATE.md`](TASK_TEMPLATE.md)
- [`coordinator`](../agents/roles/coordinator/ROLE.md), [`qa-review`](../agents/roles/qa-review/ROLE.md), [QA skill](../../.agents/skills/qa-review/SKILL.md)

## Handoff

Implementation completed in the lead chat. `npm run check` passed 24 tests and TypeScript. Android and iOS export passed after the third navigation icon design was applied. The read-only `/root/harness_nav_qa` agent independently inspected navigation assets/styles, the saved 2·3·4 options, dispatch rules, and the check runner; it found no actionable issue and independently reran `npm run check`. The signed-in app was not visually checked on a device.
