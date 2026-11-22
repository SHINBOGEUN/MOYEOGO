# Task: OAuth 로그인 후 앱 복귀 오류 복구

- **Status:** complete; Android development-build Google OAuth verified and independently reviewed
- **Lead role / owner:** coordinator / Codex
- **Execution:** delegated
- **Assigned agents:** mobile-engineering investigates and owns any `App.tsx` auth callback changes; qa-review is read-only and reviews the callback path after implementation; each stops after its bounded report
- **Related goal/decision/history:** [`PRODUCT_GOAL_V1.md`](../PRODUCT_GOAL_V1.md), [`DECISIONS.md`](../DECISIONS.md), [`PRODUCT_HISTORY.md`](../PRODUCT_HISTORY.md)
- **Files owned by this task:** mobile-engineering may edit `App.tsx` only; lead owns this task note, `docs/DECISIONS.md`, `docs/PRODUCT_HISTORY.md`, and emulator/build verification; QA owns no files

## Request and reason

Google login reaches the provider, but returning to the app shows Expo Go's blue error screen. The visible and native log error is `Failed to download remote update` / `UpdateFailedToLoad` after the `exp://<LAN-IP>:8083/--/auth/callback` link is opened. Diagnose and restore the login return flow on the Android emulator.

## Acceptance criteria

- [x] Google OAuth returns to the MOYEOGO app without Expo Go's blue error screen.
- [x] The app receives the callback using `moyeogo://auth/callback`, exchanges the authorization code, and reaches the authenticated home screen.
- [x] Verification identifies the Expo development build as required; Expo Go is not a supported OAuth test target.
- [x] Independent QA reviews the test evidence and reports findings without editing implementation.

## Relevant context

- Current auth code: `App.tsx` social login, `Linking` callback listener, and `exchangeCodeForSession`.
- `app.json` already declares the `moyeogo` scheme; Supabase URL allowlist was previously updated for it.
- Installed `android/app/build/outputs/apk/debug/app-debug.apk` on `emulator-5554` and opened it with `npx expo start --dev-client --lan --port 8083 --clear --android`.
- Logcat confirmed both `redirectTo` and Supabase's `providerRedirectTo` are `moyeogo://auth/callback`. After selecting the existing Google account, the app returned to its authenticated home screen; the Expo Go blue screen did not appear.
- The emulator briefly logged a Metro WebSocket reconnect warning while the browser was open; after OAuth the app rendered the authenticated home screen and Metro remained available on port 8083.
- QA independently reviewed the callback logs and authenticated-home screenshot. It confirmed `processedAuthCodes` guards duplicate callback handling; it did not independently count code-exchange calls. The temporary Metro reconnect warning does not change the successful session result.
- No `App.tsx` change was needed: the custom scheme and callback exchange path were already implemented. The correction was to test OAuth in the installed development build rather than Expo Go.
- Role briefs: [`mobile-engineering`](../agents/roles/mobile-engineering/ROLE.md), [`qa-review`](../agents/roles/qa-review/ROLE.md).

## Handoff

Google OAuth was verified on the Android development build. Use the installed development client and keep the Expo dev server running on port 8083 for further testing; Expo Go is not a supported target for this OAuth flow.
