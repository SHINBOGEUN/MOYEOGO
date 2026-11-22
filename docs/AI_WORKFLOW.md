# AI agent routing and harness

This is the main routing document for AI work in MOYEOGO. Read it when a request needs coordination, role assignment, or a handoff. The user is the product owner; AI roles prepare and execute work within the user's approved scope.

## Source of truth

- `docs/PRODUCT_GOAL_V1.md` defines the approved first-release scope.
- `docs/DECISIONS.md` records current approved product and technical decisions.
- `docs/PRODUCT_HISTORY.md` records what the user asked for, why the product changed, and where the current behavior is documented.
- `.agents/skills/<skill>/SKILL.md` provides a task procedure. Load only the matching skill; skills are procedures, not agent identities.
- `docs/agents/roles/<role>/ROLE.md` defines role ownership and expected output. These are portable role briefs that can be used with Codex, Claude, or another AI. A folder does not automatically start an agent or give it access to another AI's chat.

The repository root is also the Obsidian vault. Keep one Markdown source for each fact and link to it instead of making duplicate copies.

## Executing the roles

The role documents define responsibility but cannot start an agent. The coordinator makes an explicit execution choice for each request:

1. **Direct:** A focused, reversible change in one area stays with the lead agent. It still reads the relevant role and skill instructions, implements, checks, and reports. Creating extra agents for this case adds no independent value.
2. **Delegated:** For work that spans two independent roles, or affects settlement money, authentication, privacy, migration, or another high-risk journey, use the runtime's subagent tools when available. Create a task note, spawn only the needed role-scoped agents, state the acceptance criteria and exact file ownership in each assignment, and integrate their outputs here. Use a separate QA agent for independent findings; the reviewer does not edit the implementation.
3. **Sequential fallback:** If the runtime cannot create subagents, perform the necessary roles one after another in the current chat. State clearly that no separate agent ran. Never describe a role brief or task note as an executed agent.

For delegated work, the coordinator remains accountable. Wait for each assigned result, resolve conflicts, run `npm run check` for TypeScript and unit tests, and add relevant Android/iOS or service checks. Report which roles actually ran and the checks that passed. A Markdown file, task note, or scheduled reminder never runs agents by itself; a live runtime must make the dispatch calls.

## Request routing

The coordinator first classifies the request. Use the smallest number of roles that can complete it; a small task can stay with one agent.

| User request | Lead role | Add these roles when useful | Result |
| --- | --- | --- | --- |
| New feature, MVP scope, or product behavior | `product` | `ux-design`, `mobile-engineering`, `qa-review`, `documentation` | User-visible behavior, acceptance criteria, and updated decision/history notes |
| Screen layout, interaction, accessibility, or usability | `ux-design` | `product` if scope is unclear; `mobile-engineering`; `qa-review` | Flow and UI behavior spec, then a working screen and review |
| Android/iOS app feature or defect | `mobile-engineering` | `ux-design` for interaction changes; `qa-review`; `documentation` | Focused implementation, checks, and relevant documentation |
| Accounts, sync, database, photo storage, map services, or API | `product` first, then `backend-data` | `mobile-engineering`, `qa-review`, `documentation` | Options and tradeoffs before implementation; do not assume an unapproved provider, cost, or privacy rule |
| Test request, regression check, or independent review | `qa-review` | Relevant implementer for repairs after findings are accepted | Findings with severity and reproduction steps, or a clear no-findings report |
| Product decision record, setup guide, or agent handoff | `documentation` | `product` if the decision is not approved yet | Updated source document with links to related records |
| Positioning, launch plan, store listing, campaign, or growth research | `growth-marketing` | `product`, `documentation`, `qa-review` for claim checks | Research or draft for the owner to review; publishing or spending needs explicit owner authorization |
| Broad request touching several areas | `coordinator` | Assign only the roles needed from the rows above | Ordered subtasks with distinct file ownership and a final integrated result |

## Standard work cycle

1. **Intake:** Coordinator restates the requested outcome, checks the product goal and relevant decisions, and identifies unknowns. Ask the user only when a real product tradeoff is unresolved.
2. **Plan:** For multi-role work, create a task note from `docs/tasks/TASK_TEMPLATE.md`. Name one lead, acceptance criteria, relevant files, and any file boundaries. Do not create a task note for a tiny one-context change.
3. **Design:** For a new or changed user flow, the UX role describes entry points, steps, empty/loading/error states, keyboard/focus behavior, and acceptance criteria before or alongside implementation.
4. **Implement:** The implementation role makes the smallest coherent change. Read the matching skill. Keep server and marketing work dormant until requested and appropriately scoped.
5. **Review:** Use a fresh QA context for complex, calculation-sensitive, privacy-sensitive, or user-visible changes. Reviewers report findings and do not silently edit the implementation.
6. **Record:** The completing role updates the current source of truth. Documentation updates `DECISIONS.md` when an approved choice changes and appends `PRODUCT_HISTORY.md` when a request meaningfully changes behavior, scope, design, or workflow. Record the reason and link to the code/spec; do not log every typo fix.
7. **Integrate:** Coordinator resolves findings, checks the final diff and required tests, and tells the user what changed, why, and what was verified.

## Handoff rules

- One task has one accountable lead. Other roles return their deliverable to that lead.
- Never assign two active roles to edit the same file. Use serial handoffs for shared files: UX spec → implementation → QA → documentation/integration.
- Do not assume Codex, Claude, or another model can see another provider's private conversation. Pass only the necessary task note, source links, and diff.
- Avoid autonomous agent loops. A handoff must have an owner, bounded deliverable, acceptance criteria, and stop condition.
- Do not delegate just to use more agents. A separate reviewer is most useful when a defect could affect money, privacy, data loss, or a central user journey.

## Current role map

- [`coordinator`](agents/roles/coordinator/ROLE.md): Codex owns intake, routing, integration, and user updates.
- [`product`](agents/roles/product/ROLE.md): requirements, scope, acceptance criteria, and unresolved choices.
- [`ux-design`](agents/roles/ux-design/ROLE.md): user journeys, screen behavior, and usability.
- [`mobile-engineering`](agents/roles/mobile-engineering/ROLE.md): current Expo / React Native client implementation.
- [`backend-data`](agents/roles/backend-data/ROLE.md): future server, identity, storage, sync, and data architecture; use only when requested.
- [`qa-review`](agents/roles/qa-review/ROLE.md): independent verification and findings.
- [`documentation`](agents/roles/documentation/ROLE.md): source docs and product history.
- [`growth-marketing`](agents/roles/growth-marketing/ROLE.md): future positioning and launch work; use only when requested.

## Context and token use

- Start with `AGENTS.md`, this routing page when coordination is needed, then only the relevant goal/decision/role/skill files.
- Give each role a short delta: request, reason, acceptance criteria, relevant files, and relevant links. Do not paste the whole history into every handoff.
- Stable product facts belong in the product goal and decisions; the history explains why they came to be; task notes contain only temporary work.
- Role briefs are vendor-neutral. No role assumes automatic access to another provider, local machine, account, or service.

## Server and service verification

- When the user explicitly requests starting or restarting a service, and the execution method and required permissions and environment conditions are available, do it immediately without confirmation questions or unnecessary status checks; check the result afterward only as needed. For troubleshooting or reproduction requests, follow the procedures below.
- Before attributing an outage or server behavior to a cause, collect direct evidence in the smallest relevant scope: the actual running process, the current response from the target port/address, and relevant logs. Reuse evidence already collected; do not repeat checks or delegate without a concrete need.
- Record when each check was made, the target address and version/build where available, and the observed result. Label anything not directly confirmed as an assumption or hypothesis.
- For a user-reported issue, capture the reported symptom and the conditions needed to reproduce it. Using those conditions, check whether the same symptom reproduces in the actual service the user is using, and record the reproduction steps and observed result (including when it does not reproduce).
- When an app or service change requires reproduction or verification, identify the actual address and version the user is using and check that running service. Passing code tests alone does not establish that the change reached or works in the user's service.
