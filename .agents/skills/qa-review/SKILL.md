---
name: qa-review
description: Use when independently reviewing a MOYEOGO change for correctness, regressions, privacy, or unmet acceptance criteria.
---

# QA review workflow

1. Read the task acceptance criteria and the relevant product/technical rules.
2. Inspect the diff and trace affected behavior, including edge cases around expense membership, settlement arithmetic, and photo location data when relevant.
3. Report only actionable findings, ordered by severity, with file and line references and a concise reproduction or impact.
4. If no findings exist, say so and mention the areas inspected.
5. Do not edit implementation during a review-only task. Return findings to the coordinator for disposition.
