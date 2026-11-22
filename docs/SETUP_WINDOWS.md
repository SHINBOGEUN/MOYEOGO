# Windows 개발 환경 설정

## Obsidian vault

- Obsidian 1.14.4 is installed for the current Windows user.
- The user opened `C:\work\MOYEOGO` as the vault.
- This keeps product notes and agent instructions in the same Markdown files that Git tracks. Avoid creating a second copy of these notes in another vault.

## Android Studio and emulator

- Android Studio 2026.2.1.8 is installed.
- Android SDK is installed at `C:\Android\Sdk`; `ANDROID_HOME` and `ANDROID_SDK_ROOT` point there. The former SDK directory under the Korean-named user profile is retained as `Sdk.profile-backup`, and the old SDK path is a compatibility junction.
- Android Studio's system directory is redirected with `STUDIO_PROPERTIES=C:\Android\studio.properties` to `C:\Android\AndroidStudioSystem`. This avoids a stale, inaccessible `.port` marker left by an earlier forced IDE shutdown. The original marker was preserved.
- `ANDROID_USER_HOME=C:\Android\user-home`, `ANDROID_AVD_HOME=C:\Android\avd`, and `TEMP`/`TMP` are set to `C:\Temp`.
- Android Emulator 37.3.3 is installed. The `MOYEOGO_Pixel6` AVD uses the Android 16 / API 36 Google APIs x86_64 image. Windows Hypervisor Platform reports as available.
- The AVD was reset, started with software graphics, and verified booted. `adb devices -l` reports `emulator-5554` as `device` and `sys.boot_completed` is `1`.
- `npm run android` opens the project in Expo Go on `MOYEOGO_Pixel6`. The app was verified through group creation, trip creation, expense entry, and the settlement screen. Keep Metro running while testing; if the app cannot reconnect, confirm `adb devices -l` shows the emulator as `device` and reconnect Metro.

## Continue development

- Keep the Metro process running while testing. Start it again from the repository root with `npm run android`; Expo Go will open the project on the connected emulator.
- If Expo reports that port 8081 is already in use, start Metro with `npm start -- --lan --port 8082` and open the new URL shown by Expo Go. This session is currently running Metro on port 8082.
- The repository root is also the Obsidian vault. Keep project notes here rather than making a separate vault copy.
