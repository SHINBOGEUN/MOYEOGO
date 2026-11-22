# Build plan

This is the proposed implementation order for the approved first goal. It does not expand product scope. Product rules still marked open in `DECISIONS.md` must be settled before the affected feature is implemented.

## Foundation — complete

- [x] Record the approved first goal.
- [x] Set up a separate Git repository in this folder.
- [x] Add short instructions for Codex and Claude Code.
- [x] Add task-specific implementation, QA review, and documentation skills.
- [x] Create the Expo + React Native + TypeScript starter app.
- [x] Install Android Studio and Obsidian.
- [x] Finish Android SDK setup, save Android environment variables, and create a virtual device.
- [x] Open the repository root as the Obsidian vault.
- [x] Resolve the virtual device staying `offline` in `adb devices` and verify a full Android boot.
- [x] Install Expo Go and launch the starter app on the Android emulator.

## Step 1 — settle expense rules

Rules recorded in `docs/DECISIONS.md`:

- [x] Divide an expense equally among its selected participants; do not support custom shares in the first expense flow.
- [x] Allow the payer to be selected independently from the people sharing the expense.
- [x] Distribute leftover one-won units in the group's saved member order.
- [x] Recalculate settlement when its underlying expenses or participants change.
- [x] For equally minimal plans, show one deterministic plan using the group's saved member order.

## Step 2 — build the trip expense loop

- [x] Create and distinguish multiple friend groups.
- [x] Create a domestic trip in a group and set dates and treasurer.
- [x] Record expenses with payer, amount, and that expense's participants.
- [x] Calculate each member's net balance and suggested transfers.
- [x] Show each member's balance and suggested transfers on the settlement screen.

The first local prototype was exercised on the Android emulator from group creation through settlement. Device-local persistence is now implemented in Step 3; cross-device sharing remains a separate later decision.

## Step 3 — keep a local trip record — complete

- [x] Save groups, members, trips, and expenses in the device-local SQLite-backed store.
- [x] Restore saved records before showing the main app after launch.
- [x] Put storage behind `src/data/groupStore.ts` so UI state does not depend directly on a storage provider.
- [x] Keep records on the same device; do not imply that friends or other devices can see them yet.

The current adapter uses Expo SQLite's key-value store. It survives app restarts, but app removal/device loss can still remove local-only data. Cloud sync is not automatic; moving to a server will require account/access rules and an explicit migration/sync design.

## Step 4 — decide how friends share a trip

- Decide account and invitation behavior, backend/database provider, access control, photo storage, operating cost, and how existing local records move to the shared service.
- Add synchronization only after those decisions are approved.

## Step 5 — add trip photos and map locations

- Choose photo upload and storage behavior.
- Read location metadata when present and request consent before using precise location.
- Show trip photos at their locations on a domestic map.
- Define behavior for photos without location metadata.

## Step 6 — validate the 3D map memory

Build a small visual proof of concept for one selected trip photo and compare a few practical treatments, such as a 3D-style animated marker or a photo-based diorama. Choose the implementation after checking quality and performance on iPhone, iPad, and Android.

## Current setup notes

- The project uses Node.js 24 and npm 11 on this PC.
- Expo SDK 57 starter dependencies installed successfully. npm reported 22 dependency advisories during installation; review their details before preparing a public release.
- Android Studio 2026.2.1.8 and Obsidian 1.14.4 are installed. The SDK is at `C:\Android\Sdk`; the project root is open as the Obsidian vault. See `docs/SETUP_WINDOWS.md` for emulator and IDE path details.
- `npm run android` launches the Expo Go app on the API 36 emulator. The current prototype completed a sample group → domestic trip → expense → settlement flow on the emulator. `npm run test:settlement` passes four settlement cases, and `npx tsc --noEmit` passes. Local persistence now saves and restores group/trip/expense records; the next planned decision is how friends should share a trip across devices.
