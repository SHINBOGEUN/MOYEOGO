# Supabase 계정 연결 설정

이 문서는 모여Go 앱의 이메일·Google·Kakao 로그인과 Supabase 기능을 설정하는 순서다. 로그인 완료만으로 데이터 동기화나 멤버 초대가 검증되는 것은 아니다. 원격 모임 스키마와 API는 적용했지만, 두 계정 간 초대·수락·탈퇴·삭제 흐름은 실제 기기에서 확인해야 한다.

Supabase 프로젝트는 앱에 연결되어 있다. 로컬 마이그레이션 파일은 프로젝트 DB에 자동 적용되지 않으므로, 아래 SQL을 대시보드에서 실행해야 프로필·친구 기능이 동작한다.

## 1. Supabase 프로젝트 만들기

1. Supabase에서 새 프로젝트를 만들고 데이터베이스 비밀번호를 안전한 비밀번호 관리 앱에 저장한다.
2. 프로젝트의 **Project URL**과 **Publishable key**를 확인한다. 과거 화면에 `anon` key로 표시되는 공개 키도 사용할 수 있다.
3. 앱의 로컬 `.env` 파일에 아래 두 값을 설정한다. `.env`는 Git에 포함되지 않는다.

```dotenv
EXPO_PUBLIC_SUPABASE_URL=https://<project-ref>.supabase.co
EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY=<publishable-key>
```

앱에 `service_role` 또는 `secret` 키를 넣지 않는다. 설정을 바꾼 다음 Expo 서버를 재시작한다. 예: `npx.cmd expo start --clear`.

## 2. 데이터베이스 스키마와 접근 정책 적용

Supabase Dashboard의 SQL Editor에서 아래 파일을 순서대로 열어 전체 실행한다. Supabase CLI 프로젝트를 사용한다면 migration으로 적용할 수 있다.

1. [`../supabase/migrations/202610100001_initial_schema.sql`](../supabase/migrations/202610100001_initial_schema.sql)
2. [`../supabase/migrations/202610120001_profiles_and_friends.sql`](../supabase/migrations/202610120001_profiles_and_friends.sql)
3. [`../supabase/migrations/202610120002_nickname_availability.sql`](../supabase/migrations/202610120002_nickname_availability.sql)
4. [`../supabase/migrations/202610130001_friend_management.sql`](../supabase/migrations/202610130001_friend_management.sql)
5. [`../supabase/migrations/202610140001_friend_notifications.sql`](../supabase/migrations/202610140001_friend_notifications.sql)
6. [`../supabase/migrations/202610140002_friend_push_token_conflict_fix.sql`](../supabase/migrations/202610140002_friend_push_token_conflict_fix.sql)
7. [`../supabase/migrations/202610160001_remote_group_snapshots_and_friend_invites.sql`](../supabase/migrations/202610160001_remote_group_snapshots_and_friend_invites.sql)
8. [`../supabase/migrations/202610170001_remote_group_lifecycle_and_notifications.sql`](../supabase/migrations/202610170001_remote_group_lifecycle_and_notifications.sql)
9. [`../supabase/migrations/202610170002_remote_group_invitation_notifications.sql`](../supabase/migrations/202610170002_remote_group_invitation_notifications.sql)
10. [`../supabase/migrations/202610180001_group_notification_read_state.sql`](../supabase/migrations/202610180001_group_notification_read_state.sql)
11. [`../supabase/migrations/202610190001_auto_start_group_trips.sql`](../supabase/migrations/202610190001_auto_start_group_trips.sql)
12. [`../supabase/migrations/202610220001_trip_start_prompt_flow.sql`](../supabase/migrations/202610220001_trip_start_prompt_flow.sql)
13. [`../supabase/migrations/202610220002_active_member_trip_creation_notifications.sql`](../supabase/migrations/202610220002_active_member_trip_creation_notifications.sql)
14. [`../supabase/migrations/202610220003_owner_delete_group_trip.sql`](../supabase/migrations/202610220003_owner_delete_group_trip.sql)
15. [`../supabase/migrations/202610220004_group_trip_delete_tombstones.sql`](../supabase/migrations/202610220004_group_trip_delete_tombstones.sql)
16. [`../supabase/migrations/202610220005_create_group_trip_variable_collision_fix.sql`](../supabase/migrations/202610220005_create_group_trip_variable_collision_fix.sql)
17. [`../supabase/migrations/202610240001_group_trip_sync_commands.sql`](../supabase/migrations/202610240001_group_trip_sync_commands.sql)
18. [`../supabase/migrations/202610240002_group_trip_photo_owner_update_policy.sql`](../supabase/migrations/202610240002_group_trip_photo_owner_update_policy.sql)
19. [`../supabase/migrations/202610240003_group_trip_photo_orphan_select_policy.sql`](../supabase/migrations/202610240003_group_trip_photo_orphan_select_policy.sql)
20. [`../supabase/migrations/202610240004_sync_tombstone_and_photo_path_policies.sql`](../supabase/migrations/202610240004_sync_tombstone_and_photo_path_policies.sql)
21. [`../supabase/migrations/202610240005_storage_photo_delete_requires_tombstone.sql`](../supabase/migrations/202610240005_storage_photo_delete_requires_tombstone.sql)
22. [`../supabase/migrations/202610250001_group_trip_change_audit.sql`](../supabase/migrations/202610250001_group_trip_change_audit.sql)
23. [`../supabase/migrations/202610250002_group_expense_audit_read_api.sql`](../supabase/migrations/202610250002_group_expense_audit_read_api.sql)
24. [`../supabase/migrations/202610250003_group_trip_activity_details.sql`](../supabase/migrations/202610250003_group_trip_activity_details.sql)

1~6번 마이그레이션은 계정·친구·친구 알림·푸시 토큰 기능을 준비한다. 7번은 계정별 원격 모임 스냅샷과 친구 초대·수락을 추가한다. 8번은 초대 상태 조회, 생성자 전용 원격 모임 삭제, 계정 멤버 탈퇴, 생성자용 앱 내 알림을 추가한다. 9번은 초대받은 계정에게 초대 알림을 저장하고, 수락하면 모임 생성자에게 수락 알림을 저장한다. 10번은 알림 읽음 상태를 저장한다. 11번은 여행 시작 시각을 서버가 보호하도록 하고 lifecycle RPC를 준비한다. 12번은 예정일의 자동 시작을 끄고 활성 계정 회원에게 시작 확인 알림을 만들며, 사용자가 확인한 경우에만 서버 RPC가 여행을 시작하게 한다. `pg_cron`의 15분 스케줄러는 앱 내 알림 행만 생성하며 OS 푸시를 보내지 않는다. 사진 파일은 기기별 경로를 서버에 보내지 않으며 사진 메타데이터만 스냅샷에 포함된다. 모임 초대·탈퇴·삭제 및 여행 시작의 실제 기기 흐름은 별도로 검증해야 한다.

현재 연결된 `myg` 프로젝트에는 2026-10-22 기준 1~16번 마이그레이션을 SQL Editor에서 적용했다. 10~12번은 알림 읽음 상태와 사용자가 확인하는 여행 시작 흐름을 추가한다. `pg_cron`을 활성화하고 `moyeogo-trip-start-prompts` 작업을 `*/15 * * * *`로 등록했다. 13번은 모임의 활성 계정 회원이 개별 여행을 원자적으로 생성하는 RPC, 다른 활성 계정 회원에게 보내는 인앱 알림, 앱 목록에 필요한 `groupDbId`, 알림 수신자 전용 RLS/Realtime 구독을 추가한다. 14·15번은 모임장 전용 여행 삭제, 정산·비용 보호, tombstone 및 오래된 스냅샷 필터를 추가한다. **14번만 따로 적용하면 안 된다.** 14번과 15번은 반드시 이 순서로 한 트랜잭션에 묶어 적용한다. 16번은 `create_group_trip`의 변수명과 컬럼명이 겹쳐 발생한 SQL 모호성 오류를 고친다. RPC 서명과 인증된 계정 전용 실행 권한은 유지했다. 적용 후 읽기 전용 점검에서 새 변수명, 수정된 멱등성 키 조회, 기존 응답·알림 계약 및 권한을 확인했다. 실제 여행은 만들지 않았다. SQL Editor 실행은 `supabase_migrations.schema_migrations`에 CLI 이력을 자동 등록하지 않는다. 이 프로젝트에서 향후 `supabase db push`를 쓰기 전에는 기존 SQL Editor 적용 이력과 CLI 마이그레이션 이력을 먼저 맞춰, 비멱등 migration을 중복 실행하지 않도록 확인한다. 새 Supabase 프로젝트에는 선행 migration을 확인한 뒤 14·15번은 한 트랜잭션으로, 16번은 그 뒤 적용한다. 마이그레이션 적용만으로 실제 기기 동작이 검증되지는 않으므로 앱에서 별도로 테스트한다.

2026-10-24에 17~21번 shared trip sync migration을 준비하고 정적·독립 검토를 마친 뒤 `myg` (`lucgrjuewvvpgmdzjeys`) SQL Editor에서 사용자가 실행했다. 읽기 전용 postflight에서 여섯 sync 테이블, 두 SECURITY DEFINER RPC의 authenticated 허용/anon 거부, 테이블 RLS와 클라이언트 쓰기 권한 차단, 비공개 20 MiB 사진 버킷, 사진 Storage 정책, `group_sync_events` Realtime publication, 여행 삭제 보호 trigger를 확인했다. 17번은 활성 모임원 전용 여행 동기화 데이터, 원자적 변경 RPC, 한 번의 DB 스냅샷으로 읽는 RPC, 비공개 사진 버킷과 Realtime 변경 이벤트를 만든다. 18~21번은 업로드 재시도, 고아 파일 재시도, tombstone 비노출과 사진 경로 제한, tombstone이 기록된 사진만 삭제 가능하게 하는 Storage 정책을 보강한다. 사진 삭제는 대표 사진 참조를 함께 해제한다. **다섯 migration은 적용됐으므로 다시 실행하지 않는다.** 실행용 묶음은 [`../supabase/manual_apply_trip_sync_20261024.sql`](../supabase/manual_apply_trip_sync_20261024.sql)이다. 앱 TypeScript와 48개 단위 테스트는 통과했고 독립 검토에서 차단 이슈가 없었다. 실제 갤럭시·에뮬레이터 간 여행·사진·지출·정산 동기화는 아직 테스트하지 않았다. SQL Editor 수동 적용은 CLI migration history를 자동 갱신하지 않으므로, `supabase db push` 전에 이력을 맞춘다.

2026-10-25에 `202610250001_group_trip_change_audit.sql`과 `202610250002_group_expense_audit_read_api.sql`을 `myg` (`lucgrjuewvvpgmdzjeys`) Supabase SQL Editor에서 순서대로 한 트랜잭션으로 적용했다. 읽기 전용 사후 점검에서 감사 테이블과 RLS, 세 audit trigger, `list_group_expense_audit`의 authenticated 허용·anon/public 거부, 내부 trigger 함수의 앱 역할 실행 거부, 인덱스, `group_sync_events` 직접 쓰기 권한 차단을 확인했다. 감사 테이블은 앱 역할이 직접 읽거나 쓸 수 없으며, 앱은 활성 모임 멤버의 해당 여행 이력만 조회 RPC로 읽는다. 지출 삭제 이력은 변경 전 상태만 반환한다. 앱의 여행 상세 “최근 변경 이력” 화면은 RPC에 연결되어 있으나 실제 데이터 표시·기기 흐름은 확인하지 않았다. 실행 묶음은 [`../supabase/manual_apply_trip_audit_20261025.sql`](../supabase/manual_apply_trip_audit_20261025.sql)이다. 테스트용 여행·지출은 만들지 않았다. SQL Editor 적용은 CLI migration history에 자동 등록되지 않으므로 `supabase db push` 전에 이력을 맞춘다.

2026-10-25에 `202610250003_group_trip_activity_details.sql`을 `myg` (`lucgrjuewvvpgmdzjeys`) SQL Editor에서 한 트랜잭션으로 적용했다. 사전 조회에서 RPC는 없었고, 선행 audit table은 존재했다. 독립 SQL·QA 검토에서 차단 이슈는 없었다. 읽기 전용 사후 점검에서 RPC 존재, `SECURITY DEFINER`/`STABLE`, authenticated 실행 허용과 anon/public 거부, 활성 멤버 및 현재 여행 확인, 최대 5행 cursor page, 감사 테이블 RLS, authenticated/anon 직접 감사 테이블 SELECT 거부를 확인했다. RPC는 `expense.create`에만 제목과 원화 금액을 노출하며 raw audit JSON을 반환하지 않는다. 실제 앱에서 여행 활동 및 지출 제목·금액 표시까지는 아직 기기 검증하지 않았다. SQL Editor 적용은 CLI migration history에 자동 등록되지 않으므로 `supabase db push` 전에 이력을 맞춘다.

프로필과 닉네임 기능에 필요한 첫 세 마이그레이션을 적용한 뒤 로그인하면 닉네임 등록 화면이 나타난다. 이미 로그인한 계정은 migration 적용 직후 앱에서 닉네임 중복 확인을 다시 시도하면 된다. DB 적용에 실패하면 중복 확인 RPC를 찾을 수 없다는 오류가 표시되므로 세 번째 migration 적용 여부와 PostgREST 스키마 캐시를 점검한다.

## 3. 이메일 인증번호와 확인 메일

Supabase Dashboard → **Authentication → URL Configuration**에서 Site URL과 Redirect URLs를 모두 `moyeogo://auth/callback`으로 설정한다. 현재 `myg` 프로젝트의 허용 주소는 이 앱 링크 하나다. Google·Kakao 로그인은 설치형 개발 빌드에서 이 주소로 앱에 돌아온다. Expo Go의 OAuth 복귀는 공식 지원 대상이 아니므로 소셜 로그인 검증에는 설치형 개발 빌드를 사용한다. 갤럭시 실기기에서 개발 빌드로 Google 로그인과 앱 복귀를 확인했다. 개발 서버는 `npx.cmd expo start --dev-client --lan --port 8083 --clear`로 실행하며, 갤럭시와 개발 PC가 같은 네트워크에 있어야 한다.

Authentication 설정에서 이메일 가입과 **Confirm email**을 켠다. 이메일 제공자 설정에서 **Email OTP expiry**를 `180`초, **Email OTP length**를 `6`자리로 설정해야 앱의 3분 카운트다운과 여섯 자리 입력란이 서버 설정과 일치한다. 확인하지 않은 이메일도 인증 대기를 위해 Auth 사용자 목록에 임시 행으로 표시될 수 있지만, 확인 전에는 로그인 세션이 발급되지 않아 앱에 들어갈 수 없다. 중복 가입 응답은 Supabase가 계정 열거를 막기 위해 가릴 수 있으므로, 앱은 그 응답을 새 메일 발송 성공으로 표시하지 않고 로그인 화면으로 안내한다.

새 Free 프로젝트는 기본 Supabase SMTP를 사용하는 동안 인증 이메일 템플릿을 편집할 수 없다. 인증번호 메일을 쓰려면 먼저 **Authentication → SMTP Settings**에서 Custom SMTP를 켠다. 초기 테스트 발송 서비스는 Resend로 정했다. Resend의 현재 SMTP 값은 Host `smtp.resend.com`, Port `465`, Username `resend`, Password는 Resend API key이며, Sender email은 Resend에서 허용한 발신 주소를 사용한다. API key는 앱 코드나 저장소에 넣지 말고 Supabase SMTP Password에만 입력한다. Resend의 테스트 발신 주소는 제한될 수 있으므로 모든 사용자에게 보내려면 본인 도메인을 인증한다.

같은 Email 설정에서 비밀번호 최소 길이를 `8`자로 둔다. 앱 회원가입 폼은 여기에 영문 대문자와 지원 특수문자 포함 여부 및 비밀번호 확인을 검사한다. Supabase의 서버 측 문자군 정책을 더 강하게 켜면 소문자와 숫자도 함께 요구될 수 있으므로, 해당 설정을 바꿀 때는 앱의 표시 규칙도 함께 맞춘다.

현재 테스트 프로젝트에는 Resend의 Sending access API key를 발급해 Supabase SMTP Password로 저장했고 Username은 `resend`로 설정했다. 키 값은 저장소나 앱 코드에 기록하지 않는다. Resend에 `moyeogo.kr`을 추가하고 Supabase Sender email을 `noreply@moyeogo.kr`로 설정했지만, Resend Domains 상태는 DNS 검증 대기다. DNS가 검증되지 않아 실제 가입 인증 메일 발송은 아직 확인되지 않았다. 도메인 DNS 관리 화면에 Resend가 보여주는 레코드를 등록한 뒤 다시 검증한다. 도메인이 없으면 Resend의 예제 발신 주소는 테스트 범위에 제한되고 실제 가입자에게 보내는 용도로 쓸 수 없다. Authentication → **Email Templates → Confirm signup**에서 링크 대신 일회용 번호를 보내도록 확인 메일 본문을 바꾼다. 기본 `{{ .ConfirmationURL }}` 대신 아래처럼 `{{ .Token }}`을 포함한다.

```text
모여Go 이메일 인증번호: {{ .Token }}
인증번호는 3분 동안 유효합니다.
```

앱에서는 `{{ .Token }}`으로 받은 6자리 번호를 입력하고, Supabase `verifyOtp`로 가입을 확인한다. 재전송은 60초 대기 후 가능하며 새 번호를 보내면 앱의 3분 타이머가 다시 시작된다. 이 대기 시간은 UI 재전송 간격이고, 실제 메일 발송 한도는 Supabase의 Auth rate limit 및 SMTP 설정이 적용된다. 테스트용 기본 메일러에는 발송 제한이 있으므로 반복 테스트나 실제 배포 전에는 본인 도메인의 SMTP를 구성하고 발송/스팸함을 확인한다.

## 4. Google 로그인

1. Google Cloud Console에서 OAuth 동의 화면과 OAuth Web client를 만든다.
2. Supabase Dashboard → Authentication → Providers → Google에서 client ID와 client secret을 설정한다.
3. Supabase가 표시하는 Provider Callback URL (`https://<project-ref>.supabase.co/auth/v1/callback`)을 Google OAuth client의 Authorized redirect URI로 등록한다.
4. Supabase Authentication URL Configuration에는 앱으로 돌아오는 개발/네이티브 Redirect URL을 허용한다.

Google client secret은 Google/Supabase 설정 화면에만 입력하고 앱이나 저장소에 넣지 않는다.

## 5. Kakao 로그인

1. Kakao Developers에서 앱을 만들고 카카오 로그인을 활성화한다. REST API 키와 Client Secret을 만든다.
2. 동의 항목에서 필요한 프로필 닉네임과 이메일을 설정한다. 이메일은 Kakao 계정의 제공/동의 상태에 따라 없을 수 있으므로 앱은 이메일만으로 기존 모임 멤버를 자동 연결하지 않는다.
3. Supabase Dashboard → Authentication → Providers → Kakao에서 REST API key와 Client Secret을 설정한다.
4. Supabase가 표시하는 Provider Callback URL (`https://<project-ref>.supabase.co/auth/v1/callback`)을 Kakao Developers의 Redirect URI로 등록한다.
5. Supabase Authentication URL Configuration에는 별도로 앱의 개발/네이티브 Redirect URL을 허용한다.

## 6. 기기 테스트

- 회원가입에서 이메일 아이디와 기본 도메인 또는 직접 입력 도메인을 조합하고, 받은 인증번호를 3분 안에 입력해 계정을 확인한다. 60초 후 재전송해 새 번호가 이전 번호를 대체하고 타이머가 갱신되는지도 확인한다.
- 같은 계정으로 로그인/로그아웃을 확인한다. 앱을 다시 켠 뒤 세션이 유지되는지 확인한다.
- Google과 Kakao 각각 브라우저 로그인, 앱 복귀, 취소 흐름을 확인한다.
- 설정값이 없으면 앱은 계정 없이 기존 로컬 사용을 계속 허용한다.

## 7. 친구 알림과 푸시

친구 요청 INSERT와 대기 중 요청 수락은 각각 수신자 소유의 `friend_notifications` 행을 만든다. 모든 로그인 화면에서 알림함과 읽지 않은 수를 확인할 수 있다. 앱이 열려 있으면 Realtime으로 새 행을 반영한다. `user_devices`의 Expo 토큰은 직접 조회·수정 권한을 주지 않고 로그인 사용자용 등록·해제 RPC로만 관리한다. 알림 설정을 끄거나 로그아웃하면 해당 기기 토큰을 해제한다.

현재 `myg` 프로젝트에는 [`../supabase/functions/friend-notification-push/index.ts`](../supabase/functions/friend-notification-push/index.ts) 함수를 `friend-notification-push`로 배포하고, 함수 전용 비밀 헤더를 Edge Function Secret `FRIEND_NOTIFICATIONS_WEBHOOK_SECRET`에 저장했다. Edge Function의 레거시 JWT 검증은 껐으며 함수 코드가 전용 비밀 헤더를 검증한다. Database Webhooks 통합(`pg_net`)을 설치하고 `public.friend_notifications`의 INSERT만 이 함수에 POST하는 `friend_notification_push` 웹훅을 만들었다. 비밀값은 저장소나 앱에 기록하지 않는다. 새 프로젝트에서도 같은 함수·비밀 헤더·웹훅을 별도로 배포해야 한다.

Android 원격 푸시를 위해 Firebase 프로젝트 `moyeogo-push-2026`에 Android 앱 `com.shinbogeun.moyeogo`를 등록했다. 루트의 `google-services.json`과 푸시 발송 전용 서비스 계정 키(`.secrets/`)는 Git에서 제외한다. 전용 계정에는 FCM 발송 역할만 부여하고, FCM V1 키를 Expo 계정 `shinbogeun`의 `moyeogo` Android `development` 자격 증명에 연결했다. `app.json`에는 EAS 프로젝트 ID와 Android Firebase 설정 경로가 있다. JDK 17로 새 개발 APK를 빌드해 에뮬레이터와 갤럭시에 설치했다. 알림 권한 허용 후 기기 토큰 등록을 DB에서 확인했고, Expo 테스트 푸시의 티켓·영수증이 모두 `ok`였다. 서로 다른 두 계정으로 에뮬레이터에서 갤럭시로 친구 요청을 보내 갤럭시 푸시 수신을 확인했고, 갤럭시에서 수락하자 에뮬레이터 OS 알림창에 수락 푸시가 표시됐다. 앱 안의 친구 목록·알림함도 갱신됐다. 알림 설정 OFF·로그아웃 후 미수신과 iOS는 아직 실기기 검증 전이다. Expo Go는 이 푸시 검증 대상이 아니다.

## 아직 연결하지 않은 서버 기능

- 모임/여행/지출의 최초 생성과 기기 간 동기화
- 현재 SQLite 데이터 백업과 중복 없는 서버 이전
- 초대 링크 화면과 초대 수락 화면
- 비공개 사진 Storage bucket 생성/정책, 사진 업로드
- 정산 생성·수정 무효화·송금 확인·여행 완료를 원자적으로 수행하는 서버 함수
- 알림 설정 OFF·로그아웃 후 미수신 검증; iOS 자격 증명과 실기기 검증
- 친구를 모임에 초대하거나 그룹 초대 코드를 입력하는 화면

서버 동기화 구현 전에 사진 GPS 위치의 공유 범위, 로컬 데이터 충돌 해결, 프로젝트 리전/백업 정책을 확정한다.

## 공식 참고

- [Supabase Expo React Native 빠른 시작](https://supabase.com/docs/guides/getting-started/quickstarts/expo-react-native)
- [Supabase 이메일·비밀번호 가입과 이메일 확인](https://supabase.com/docs/guides/auth/passwords)
- [Supabase 비밀번호 강도 설정과 허용 특수문자](https://supabase.com/docs/guides/auth/password-security)
- [Supabase JavaScript OTP 검증](https://supabase.com/docs/reference/javascript/auth-verifyotp)
- [Supabase 가입 인증 메일 재전송](https://supabase.com/docs/reference/javascript/auth-resend)
- [Supabase Auth 일반 설정](https://supabase.com/docs/guides/auth/general-configuration)
- [Supabase 이메일 템플릿의 OTP 변수](https://supabase.com/docs/guides/auth/auth-email-templates)
- [Supabase Google 로그인](https://supabase.com/docs/guides/auth/social-login/auth-google)
- [Supabase Kakao 로그인](https://supabase.com/docs/guides/auth/social-login/auth-kakao)
- [Supabase 모바일 딥 링크](https://supabase.com/docs/guides/auth/native-mobile-deep-linking)
- [Supabase Row Level Security](https://supabase.com/docs/guides/database/postgres/row-level-security)
