import type { ImapPresetInfo } from '../../../shared/types'

export const IMAP_PRESETS: ImapPresetInfo[] = [
  {
    id: 'icloud',
    label: 'iCloud',
    imap: { host: 'imap.mail.me.com', port: 993, secure: true },
    smtp: { host: 'smtp.mail.me.com', port: 587, secure: false },
    hint: 'iCloud 메일은 Apple 계정의 "앱 암호"가 필요합니다. account.apple.com → 로그인 및 보안 → 앱 암호에서 생성한 뒤 붙여넣으세요. 사용자 이름은 전체 iCloud 주소(@icloud.com)입니다.',
    link: 'https://account.apple.com'
  },
  {
    id: 'naver',
    label: '네이버',
    imap: { host: 'imap.naver.com', port: 993, secure: true },
    smtp: { host: 'smtp.naver.com', port: 465, secure: true },
    hint: '네이버 메일 → 환경설정 → POP3/IMAP 설정에서 "IMAP/SMTP 사용"을 켜세요. 2단계 인증을 사용 중이면 네이버 내정보 → 보안설정 → 애플리케이션 비밀번호를 생성해 입력하세요. 사용자 이름은 네이버 아이디입니다.',
    link: 'https://mail.naver.com'
  },
  {
    id: 'custom',
    label: '기타 (IMAP/SMTP)',
    imap: { host: '', port: 993, secure: true },
    smtp: { host: '', port: 587, secure: false },
    hint: '메일 서비스의 IMAP/SMTP 서버 정보를 입력하세요.'
  }
]
