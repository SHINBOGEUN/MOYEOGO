# Claude Code project instructions

Follow the repository's `AGENTS.md` and approved product goal in `docs/PRODUCT_GOAL_V1.md`.

Use `docs/AI_WORKFLOW.md` to route non-trivial requests and load only the matching role brief under `docs/agents/roles/`. Load the relevant procedure from `.agents/skills/<skill>/SKILL.md` when it fits. Keep context narrow; do not read every project document by default.

Append meaningful user requests, rationale, and outcomes to `docs/PRODUCT_HISTORY.md`; update `docs/DECISIONS.md` only for current approved choices.

The user is the product owner. Use task files and Git diffs to exchange work with Codex. Do not modify files another agent is currently assigned to. Reviewer tasks should produce findings and leave implementation edits to the implementer.
