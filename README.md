# MOYEOGO

Android and iOS app for managing friends' domestic trips, expense-specific cost sharing, settlement, and location-based photo memories.

## Project notes

- [Approved first goal](docs/PRODUCT_GOAL_V1.md)
- [Project decisions](docs/DECISIONS.md)
- [Product and request history](docs/PRODUCT_HISTORY.md)
- [AI collaboration workflow](docs/AI_WORKFLOW.md)
- [Agent role briefs](docs/agents/roles/)
- [Build plan and current setup](docs/BUILD_PLAN.md)
- [Windows setup steps](docs/SETUP_WINDOWS.md)

The repository root is also the Obsidian vault. Open this folder in Obsidian to browse the same Markdown files used by the development agents.

Run `npm run check` to validate TypeScript and the current unit tests. The [AI collaboration workflow](docs/AI_WORKFLOW.md) explains when a live agent runtime dispatches separate role agents and when one agent handles a focused task directly.

## Client direction

Expo + React Native + TypeScript. Start the development server with `npm start`, then open the project in Expo Go on an Android or iOS device.
