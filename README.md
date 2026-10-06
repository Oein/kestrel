# Mailbird

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

데이터베이스와 설정은 `~/Library/Application Support/Mailbird/mailbird.sqlite`에 저장됩니다.
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

검색창은 `from:`, `to:`, `subject:`, `is:unread`, `is:starred`, `has:attachment`를 지원합니다. 로컬 결과가 먼저 표시되고 서버 검색 결과가 이어서 합쳐집니다.

## 개발 참고

- `MAILBIRD_USER_DATA=/tmp/mb pnpm dev` 로 별도 프로필(빈 DB)로 실행할 수 있습니다.
- 구조: `src/main`(SQLite, 동기화, 제공자), `src/preload`(타입이 지정된 `window.api` 브리지), `src/renderer`(React UI), `src/shared`(공용 타입).
