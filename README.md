# Kestrel

빠른 속도를 최우선으로 하는 데스크톱 메일 클라이언트입니다. Gmail과 비슷한 UI에 읽기 창(분할 보기), Gmail 단축키, ⌘K 명령 팔레트, 통합 받은편지함을 제공합니다.

- 모든 메일은 로컬 SQLite(FTS5 검색 포함)에 캐시되어 즉시 표시되고, 동기화는 백그라운드에서 진행됩니다.
- 읽음/별표/보관/삭제/라벨/보내기는 낙관적 UI로 즉시 반영되며, 서버 반영에 실패하면 자동으로 되돌립니다.
- 보관·삭제·보내기는 5초 동안 실행취소할 수 있습니다.
- Gmail은 Gmail API(배치 요청 + history 증분 동기화), iCloud·네이버·기타는 IMAP(IDLE 실시간) + SMTP를 사용합니다.

## 요구 사항

- macOS, Node.js 24, pnpm

## 설치 및 실행

```bash
pnpm install      # better-sqlite3 네이티브 모듈 포함 설치 (postinstall: electron-builder install-app-deps)
pnpm dev          # 개발 모드 실행
pnpm build        # 프로덕션 빌드 (out/)
pnpm typecheck    # 타입 검사
pnpm lint         # ESLint
pnpm test         # 단위 테스트 (vitest)
pnpm package      # macOS 앱 번들 생성 (dist/)
```

데이터베이스와 설정은 `~/Library/Application Support/Kestrel/kestrel.sqlite`에 저장됩니다.
OAuth refresh token, IMAP 비밀번호, OAuth 클라이언트 보안 비밀번호는 Electron `safeStorage`(macOS 키체인)로 암호화해 저장합니다.

## Gmail 설정 (Google OAuth 클라이언트)

Gmail 계정을 추가하려면 Google OAuth 클라이언트(데스크톱 앱)가 필요합니다. 앱의 **설정 → OAuth 클라이언트**에서 직접 등록하거나, `.env`로 처음 실행할 때 가져올 수 있습니다. 여러 클라이언트를 등록할 수 있으며(예: 개인 Gmail용, 학교·회사 Workspace 도메인용), 계정을 추가할 때 이메일 도메인에 맞는 클라이언트가 자동으로 선택됩니다.

1. [Google Cloud 콘솔](https://console.cloud.google.com/)에서 프로젝트를 만듭니다.
2. **Gmail API**를 사용 설정합니다.
3. **OAuth 동의 화면**을 구성합니다.
   - 개인 @gmail.com: 사용자 유형 **외부**, 게시 상태 **테스트**로 두고 본인 계정을 테스트 사용자로 추가합니다.
   - Google Workspace 도메인: 사용자 유형 **내부**로 만들면 해당 도메인 사용자만 로그인할 수 있습니다.
4. **사용자 인증 정보 → OAuth 클라이언트 ID 만들기 → 데스크톱 앱**을 선택합니다.
5. 클라이언트 ID / 보안 비밀번호를 앱에 붙여넣거나 `.env`에 적습니다.

> 테스트 모드 앱의 refresh token은 7일 후 만료됩니다. 만료되면 "재로그인 필요" 배너가 뜨며 한 번 클릭으로 다시 로그인할 수 있습니다. 그동안에도 캐시된 메일은 계속 볼 수 있습니다.

### `.env` (선택)

`.env.example`을 복사해 `.env`를 만듭니다. 앱을 실행할 때 아래 클라이언트들을 OAuth 클라이언트 목록으로 가져옵니다(같은 client id는 한 번만 가져오며, 앱에서 삭제한 클라이언트는 다시 생기지 않습니다). 가져온 뒤에는 `.env`가 없어도 됩니다.

```dotenv
# 기본 클라이언트 → "기본 (.env)", 기본값으로 지정
GOOGLE_CLIENT_ID=...apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=...

# 접미사 규칙: GOOGLE_CLIENT_ID_<SUFFIX> → "<SUFFIX> (.env)"
GOOGLE_CLIENT_ID_SCHOOL=...apps.googleusercontent.com
GOOGLE_CLIENT_SECRET_SCHOOL=...
GOOGLE_CLIENT_DOMAINS_SCHOOL=school.ac.kr   # 쉼표로 구분, 이 도메인 주소에 자동 사용
```

로그인은 시스템 브라우저에서 진행되며(루프백 `http://127.0.0.1:<임의 포트>` + PKCE), 요청 권한은 `gmail.modify`, `gmail.send`, `openid email profile`입니다.

## iCloud 메일

- Apple 계정의 **앱 암호**가 필요합니다: [account.apple.com](https://account.apple.com) → 로그인 및 보안 → 앱 암호.
- 사용자 이름은 전체 iCloud 주소(예: `name@icloud.com`)입니다.
- 서버: IMAP `imap.mail.me.com:993` (SSL/TLS), SMTP `smtp.mail.me.com:587` (STARTTLS)

## 네이버 메일

- 네이버 메일 → 환경설정 → **POP3/IMAP 설정**에서 IMAP/SMTP 사용을 켭니다.
- 2단계 인증을 사용 중이면 **애플리케이션 비밀번호**를 만들어 입력합니다.
- 사용자 이름은 네이버 아이디입니다.
- 서버: IMAP `imap.naver.com:993` (SSL/TLS), SMTP `smtp.naver.com:465` (SSL/TLS)

## 기타 IMAP/SMTP

계정 추가 → 기타에서 서버 주소/포트/보안 방식을 직접 입력합니다. 저장 전에 연결 테스트를 수행합니다.

## 메뉴바 · 알림 · 로그인 시 자동 실행

- **메뉴바 아이콘**: 메뉴바에 봉투 아이콘과 읽지 않은 메일 수가 표시됩니다. 메뉴: 열기 / 새 메일 / 지금 동기화 / 로그인 시 자동 실행 / 설정… / 종료.
- **창을 닫으면 메뉴바에 남기기**(기본 켬): 창을 닫아도 앱이 메뉴바에 남아 계속 동기화하고 알림을 보냅니다. Dock 아이콘이나 메뉴바의 "열기"로 다시 엽니다. `⌘Q`나 메뉴바의 "종료"는 실제로 종료합니다(대기 중인 작업은 서버에 반영한 뒤 종료). 끄면 창을 닫을 때 앱이 종료됩니다.
- **새 메일 알림**(기본 켬): 앱이 켜진 뒤 받은편지함에 새로 도착한 읽지 않은 메일만 알립니다(계정 첫 동기화·앱 시작 시 따라잡기 분량은 알리지 않음). 한 번에 4통 이상이면 "새 메일 N통" 요약 알림 하나로 묶습니다. 알림을 클릭하면 해당 대화가 열립니다. 창을 보고 있을 때와 자동 분류 규칙이 보관·읽음·삭제 처리한 메일은 알리지 않습니다. 설정 → 일반의 "테스트 알림 보내기"로 확인할 수 있습니다.
- **로그인 시 자동 실행**(기본 끔): 켜면 Mac 로그인 시 창 없이 메뉴바에서 시작합니다. 로그인 항목은 **패키징된(가능하면 서명된) 앱**에서만 등록됩니다. `pnpm dev`에서는 설정값만 저장됩니다.
- `⌘,` 설정, `⌘N` 새 메일.

## 자동 분류 규칙 (JavaScript / Python)

설정 → **자동 분류**에서 규칙을 만듭니다. 켜 둔 규칙은 새 메일이 받은편지함에 도착할 때마다(알림보다 먼저) 위에서부터 차례로 실행되며, 뒤 규칙은 앞 규칙이 바꾼 결과(라벨·분류·읽음·별표)를 봅니다. "지금 받은편지함에 적용"은 최근 받은편지함 메일 500통에 적용하고, "테스트"는 선택한 메일로 실행해 결과 JSON만 보여 줍니다(메일은 바뀌지 않음).

규칙은 메일 하나를 다음 JSON으로 받습니다.

```js
{ id, account: { id, email, provider }, from: { name, email }, to: [...], cc: [...],
  subject, snippet, text /* 본문이 캐시돼 있으면 문자열, 아니면 null */, date /* ms */,
  labels: ['INBOX', 'company/github', ...] /* 사용자 라벨·폴더는 전체 경로, 시스템 라벨은 대문자 */,
  category: 'primary' | 'promotions' | 'social' | 'updates', unread, starred, hasAttachments,
  attachments: [{ filename, mimeType, size }] }
```

그리고 다음 객체(또는 아무것도 하지 않으려면 `null`)를 반환합니다.

```js
{ addLabels: ['라벨'], removeLabels: ['라벨'], category: 'promotions', archive: true, markRead: true, star: true, trash: true }
```

- **JavaScript**: `function rule(msg) { ... }`, `export default (msg) => ...`, 또는 함수 본문만(`msg`를 쓰고 `return`) 작성할 수 있습니다. 별도 프로세스(Electron utilityProcess)의 `node:vm` 샌드박스에서 실행되며 `require`·`process`·`fs`·네트워크에 접근할 수 없고, 메일 한 통당 200ms 제한이 있습니다. 동기 함수만 지원합니다. `console.log` 출력은 테스트 결과에 표시됩니다.
- **Python**: `def rule(msg): ...`를 정의합니다. `python3`(Homebrew `/opt/homebrew/bin`, `/usr/local/bin`, PATH, `/usr/bin` 순으로 찾음, `KESTREL_PYTHON`으로 지정 가능)로 실행되며 메일 한 통당 0.5초 제한이 있습니다. Python 규칙은 샌드박스가 아니므로 본인이 작성한 코드만 사용하세요. `print` 출력은 테스트 결과에 표시됩니다.
- **Gmail**: 라벨은 Gmail 라벨이며 없으면 새로 만듭니다. `category`는 `CATEGORY_*` 라벨을 바꿉니다(`primary` = 기본).
- **IMAP(iCloud·네이버 등)**: `addLabels`의 **첫 번째** 이름의 폴더로 메일을 **이동**합니다(없으면 만듦). `removeLabels`는 무시됩니다. `category`는 이 앱에만 저장되어 받은편지함 분류 탭(프로모션·소셜·업데이트)에 쓰입니다. 우선순위는 `trash` > `addLabels` > `archive`입니다.
- 오류가 나도 동기화는 계속되며, 규칙별 마지막 오류·적용 횟수·마지막 실행 시각이 표시됩니다.

## 단축키

| 키 | 동작 |
| --- | --- |
| `c` | 편지쓰기 |
| `/` | 검색 |
| `⌘K` | 명령 팔레트 |
| `j` / `k` | 다음 / 이전 대화 |
| `o`, `Enter` | 열기 |
| `u`, `Esc` | 목록으로 |
| `e` / `#` | 보관 / 삭제 |
| `s` | 별표 |
| `x` | 선택 |
| `Shift+I` / `Shift+U` | 읽음 / 읽지 않음 |
| `r` / `a` / `f` | 답장 / 전체답장 / 전달 |
| `z` | 실행취소 |
| `g` `i`/`s`/`t`/`d`/`a` | 받은편지함 / 별표 / 보낸편지함 / 임시보관함 / 전체보관함 |
| `⌘Enter` | (편지쓰기 창) 보내기 |
| `⌘,` | 설정 |
| `⌘N` | 새 메일 |

검색창은 `from:`, `to:`, `subject:`, `is:unread`, `is:starred`, `has:attachment`를 지원합니다. 로컬 결과가 먼저 표시되고 서버 검색 결과가 이어서 합쳐집니다.

## 개발 참고

- `KESTREL_USER_DATA=/tmp/mb pnpm dev` 로 별도 프로필(빈 DB)로 실행할 수 있습니다.
- `KESTREL_DEMO=1 pnpm dev` 는 가짜 메일이 채워진 별도 프로필(`Kestrel-demo`)로 실행합니다. 동기화가 꺼져 있고 서버 반영은 로컬에만 적용되며, 보낸 메일은 로컬 보낸편지함에 저장됩니다.
- JavaScript 규칙 워커는 `out/main/ruleWorker.js`(`src/main/rules/jsWorker.ts`)로 따로 빌드됩니다.
- 구조: `src/main`(SQLite, 동기화, 제공자), `src/preload`(타입이 지정된 `window.api` 브리지), `src/renderer`(React UI), `src/shared`(공용 타입).
