# MOYEOGO project instructions

- Treat `docs/PRODUCT_GOAL_V1.md` as the approved product goal. Keep work inside that scope unless the user changes it.
- Use `docs/AI_WORKFLOW.md` to route non-trivial requests to the right role; read only the linked role, goal, decision, and skill documents needed for the task.
- For a request spanning two independent roles, or touching settlement money, authentication, privacy, data migration, or another high-risk flow, explicitly spawn role-scoped subagents when the runtime supports them. Give each agent bounded acceptance criteria and distinct file ownership; use a separate QA agent for independent review. Keep a small single-area edit with the lead agent. If subagents are unavailable, perform the roles sequentially and say so; role Markdown files alone do not launch agents.
- Record current approved choices in `docs/DECISIONS.md`. Append meaningful user requests, reasons, and outcomes to `docs/PRODUCT_HISTORY.md` so future work can recover why a behavior exists.
- The user is the product owner. Ask about product tradeoffs only when the existing goal and decisions do not resolve them.
- Treat `.agents/skills/` as task procedures and `docs/agents/roles/` as reusable role briefs. Role folders do not automatically launch agents or share provider chat history.
- Keep changes focused. Do not edit the same files as another active agent; hand off through a task note or Git diff.
- For code tasks, follow the task's acceptance criteria and report what you changed and what you checked. Review tasks must report findings without silently changing implementation.
- Run `npm run check` for TypeScript and unit-test validation after app code changes, then add platform-specific checks appropriate to the change. Report any check that could not run.
- Do not add secrets, credentials, or personal information to Git. Keep local secrets in ignored `.env` files.
- Update the relevant Markdown source in place. The repository root is also the Obsidian vault; do not create a second copy of project documentation.
