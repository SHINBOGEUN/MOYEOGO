# Task: Friend request and acceptance notifications

- **Status:** in progress
- **Lead role / owner:** coordinator / Codex
- **Execution:** delegated
- **Assigned agents:** `backend-data` owns notification SQL migration and push-dispatch Edge Function; `mobile-engineering` owns app UI, data client, Expo notification dependencies/config; `qa-review` independently reviews the integrated change without editing it.
- **Related goal/decision/history:** [`../PRODUCT_GOAL_V1.md`](../PRODUCT_GOAL_V1.md) friends-in-groups scope; [`../DECISIONS.md`](../DECISIONS.md) friend connections and account notification preference.
- **Files owned by this task:** `supabase/migrations/`, `supabase/functions/`, `App.tsx`, `src/data/social.ts`, notification client files, `package.json`, `package-lock.json`, `app.json`, `tsconfig.json`, `docs/SUPABASE_SETUP.md`, `docs/DECISIONS.md`, `docs/PRODUCT_HISTORY.md`.

## Request and reason

When a user sends a friend request, the recipient should see a phone notification. The notification entry point should be available throughout the signed-in app, not only on the home screen. When the recipient accepts, the requester should be notified on their phone too.

## Acceptance criteria

- [ ] A new friend request creates exactly one recipient-owned notification; acceptance creates exactly one requester-owned notification. Rejection and cancellation create no acceptance notification.
- [ ] Signed-in users can see unread count and open their own notification list from every authenticated screen; tapping a request/acceptance entry leads to the relevant friend view. Other users cannot read or fabricate these records.
- [ ] New records appear across devices promptly while the app is open and after relaunch; read state is persisted.
- [ ] A device with notification permission and the account setting enabled registers a private push token. Request and acceptance generate remote push while the app is backgrounded; disabling notifications or logging out stops future delivery to that device/account.
- [ ] Push delivery failure does not undo the friend action, expose tokens, or produce duplicate records. Existing friend requests and nickname/profile flows still work.
- [ ] Schema/function configuration is applied to the live Supabase project where possible; Android physical-device test is reported honestly. iOS credential limitations are documented if not verifiable here.

## Relevant context

- Current friend RPCs and preferences: `supabase/migrations/202610120001_profiles_and_friends.sql`, `supabase/migrations/202610100001_initial_schema.sql`, `src/data/social.ts`, `App.tsx`.
- Current dev build uses `moyeogo://auth/callback`; Expo Go cannot test push on recent SDKs.

## Handoff

Mobile and backend implementation passed independent QA after account-switch/token cleanup fixes. `npm run check` passed TypeScript and 24 tests. Six SQL migrations, the Edge Function, secret, and database webhook were applied to live `myg`. The user accepted Firebase Terms; `moyeogo-push-2026` and its Android app are registered. A dedicated service account with the FCM sender role was created, and its key was assigned to the EAS Android `development` push credential. A JDK 17 Android development APK was installed on the emulator and Galaxy. The first token registration exposed an ambiguous `ON CONFLICT (push_token)` reference; migration six names the unique constraint explicitly. Token registration succeeded afterward. A Galaxy and emulator with separate accounts completed a friend-request/acceptance round trip: the Galaxy received the request push; the emulator OS shade received the acceptance push, and its friend count and unread notification updated. QA found a possible lost-response token leak; the client now retains the pending token for logout/retry cleanup, and QA confirmed that path. Notification OFF/logout non-delivery and iOS remain unverified. See [`../SUPABASE_SETUP.md`](../SUPABASE_SETUP.md#7-친구-알림과-푸시).
