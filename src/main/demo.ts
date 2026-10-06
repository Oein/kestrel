// Dev-only demo profile: fills an empty database with realistic fake mail so the UI can be
// designed and screenshotted without real accounts. Enabled with MAILBIRD_DEMO=1 (never in packaged builds).
import type { Address } from '../shared/types'
import { mailboxId, type MailboxUpsert, type MessageUpsert, type Repo } from './db/repo'

const ACCOUNTS = [
  { id: 'demo-personal', provider: 'gmail', preset: 'gmail', email: 'minji.kim@example.com', name: '김민지', color: '#e8552d' },
  { id: 'demo-school', provider: 'gmail', preset: 'gmail', email: 'minji@school.example.kr', name: '김민지', color: '#3b82f6' },
  { id: 'demo-naver', provider: 'imap', preset: 'naver', email: 'minji@naver.example', name: '김민지', color: '#10b981' }
] as const

const SYSTEM: MailboxUpsert[] = [
  { remoteId: 'INBOX', name: '받은편지함', path: '받은편지함', role: 'inbox', type: 'system' },
  { remoteId: 'STARRED', name: '별표편지함', path: '별표편지함', role: 'starred', type: 'system' },
  { remoteId: 'SENT', name: '보낸편지함', path: '보낸편지함', role: 'sent', type: 'system' },
  { remoteId: 'DRAFT', name: '임시보관함', path: '임시보관함', role: 'drafts', type: 'system' },
  { remoteId: 'SPAM', name: '스팸', path: '스팸', role: 'junk', type: 'system' },
  { remoteId: 'TRASH', name: '휴지통', path: '휴지통', role: 'trash', type: 'system' },
  { remoteId: 'CATEGORY_PROMOTIONS', name: '프로모션', path: '프로모션', role: null, type: 'category' },
  { remoteId: 'CATEGORY_SOCIAL', name: '소셜', path: '소셜', role: null, type: 'category' },
  { remoteId: 'CATEGORY_UPDATES', name: '업데이트', path: '업데이트', role: null, type: 'category' }
]

const LABELS: Record<string, MailboxUpsert[]> = {
  'demo-personal': [
    { remoteId: 'L_company', name: 'company', path: 'company', role: null, type: 'user', colorBg: '#16a765', colorText: '#ffffff' },
    { remoteId: 'L_github', name: 'github', path: 'company/github', role: null, type: 'user', colorBg: '#434343', colorText: '#ffffff' },
    { remoteId: 'L_google', name: 'google', path: 'company/google', role: null, type: 'user', colorBg: '#b694e8', colorText: '#ffffff' },
    { remoteId: 'L_contest', name: '공모전', path: '공모전', role: null, type: 'user', colorBg: '#f2b2a8', colorText: '#8a1c0a' }
  ],
  'demo-school': [
    { remoteId: 'L_class', name: '수업', path: '수업', role: null, type: 'user', colorBg: '#a4c2f4', colorText: '#0d3472' },
    { remoteId: 'L_club', name: '동아리', path: '동아리', role: null, type: 'user', colorBg: '#fad165', colorText: '#684e07' }
  ],
  'demo-naver': []
}

type Seed = {
  acc: string
  from: Address
  subject: string
  snippet: string
  hoursAgo: number
  read?: boolean
  star?: boolean
  cat?: 'CATEGORY_PROMOTIONS' | 'CATEGORY_SOCIAL' | 'CATEGORY_UPDATES'
  labels?: string[]
  files?: [string, string, number][]
  thread?: number
}

const P = 'demo-personal'
const S = 'demo-school'
const N = 'demo-naver'
const a = (name: string, email: string): Address => ({ name, email })

const SEEDS: Seed[] = [
  { acc: P, from: a('GitHub', 'noreply@github.com'), subject: '[minji/mailbird] PR #12: 읽기 창 렌더링 최적화', snippet: 'minji requested your review on this pull request. 변경된 파일 7개, +214 −88', hoursAgo: 0.2, labels: ['L_github'] },
  { acc: S, from: a('이수진 선생님', 'teacher.lee@school.example.kr'), subject: '정보과학 수행평가 제출 안내 (10/10 마감)', snippet: '안녕하세요. 이번 수행평가는 팀 프로젝트 보고서와 발표 자료를 함께 제출합니다. 제출 형식은 PDF이며', hoursAgo: 0.5, labels: ['L_class'], files: [['수행평가_안내.pdf', 'application/pdf', 482_000]] },
  { acc: P, from: a('Google', 'no-reply@accounts.google.com'), subject: '보안 알림: Mac에서 새로 로그인함', snippet: 'minji.kim@example.com 계정에 새로운 로그인이 감지되었습니다. 본인이 맞다면 아무 조치도 필요하지 않습니다.', hoursAgo: 1.3, star: true, labels: ['L_google'] },
  { acc: N, from: a('네이버페이', 'pay@navercorp.com'), subject: '결제가 완료되었습니다 — 무신사 스토어', snippet: '주문번호 2026100612345 · 결제금액 54,900원 · 배송 예정일 10월 8일(수)', hoursAgo: 2.1, read: true },
  { acc: P, from: a('K-ICT 빅데이터센터', 'dcc@kbig.kr'), subject: '[DCC 필독] 예선 기간 주요 안내사항 및 제출 일정 안내', snippet: '안녕하세요. K-ICT 빅데이터센터입니다. 8월부터 시작된 데이터AI 크리에이터 캠프 예선 일정이 곧 마감됩니다.', hoursAgo: 4, labels: ['L_contest'], files: [['예선_제출양식.hwp', 'application/x-hwp', 120_000], ['일정표.pdf', 'application/pdf', 230_000]] },
  { acc: S, from: a('로봇공학 동아리', 'robotics@school.example.kr'), subject: '이번 주 금요일 정기 모임 장소 변경', snippet: '과학관 2층 로봇실 → 본관 3층 세미나실로 변경되었습니다. 노트북 꼭 챙겨 오세요!', hoursAgo: 5, read: true, labels: ['L_club'] },
  { acc: P, from: a('Vercel', 'notifications@vercel.com'), subject: 'Deployment ready: mailbird-site', snippet: 'Your deployment to production is live. Build time 38s · 3 functions · Edge network', hoursAgo: 7, read: true, cat: 'CATEGORY_UPDATES' },
  { acc: P, from: a('OpenBadge', 'badge@openbadge.or.kr'), subject: '(주)케이티, (주)한국경제신문에서 오픈 배지 수여 안내', snippet: '김민지 님, AICE Basic 배지가 발급되었습니다. 배지 지갑에서 확인하고 공유해 보세요.', hoursAgo: 26, read: true },
  { acc: N, from: a('토스', 'no-reply@toss.im'), subject: '이번 달 소비 리포트가 도착했어요', snippet: '9월에는 지난달보다 12% 덜 썼어요. 가장 많이 쓴 곳은 편의점이에요.', hoursAgo: 28, read: true, cat: 'CATEGORY_UPDATES' },
  { acc: P, from: a('이도윤', 'doyoon.lee@gmail.com'), subject: 'Re: 해커톤 팀 구성 관련', snippet: '좋아요! 그럼 프론트는 제가 맡고 백엔드는 성현 님이 맡는 걸로 할게요. 회의는 목요일 저녁 어때요?', hoursAgo: 30, thread: 3 },
  { acc: S, from: a('교무기획부', 'office@school.example.kr'), subject: '[공지] 2학기 중간고사 시간표', snippet: '2학기 중간고사 시간표를 안내합니다. 첨부파일을 확인해 주시기 바랍니다.', hoursAgo: 32, star: true, files: [['중간고사_시간표.xlsx', 'application/vnd.ms-excel', 41_000]] },
  { acc: P, from: a('Figma', 'no-reply@figma.com'), subject: '서진 님이 "Mailbird UI v2"에 댓글을 남겼습니다', snippet: '"사이드바 너비를 조금 줄이면 목록이 훨씬 시원해 보일 것 같아요."', hoursAgo: 50, read: true, cat: 'CATEGORY_SOCIAL' },
  { acc: P, from: a('29CM', 'news@29cm.co.kr'), subject: '🍂 가을 아우터 최대 60% 시즌오프', snippet: '이번 주말까지만 진행되는 시즌오프. 지금 바로 확인하세요.', hoursAgo: 52, read: true, cat: 'CATEGORY_PROMOTIONS' },
  { acc: P, from: a('2026 관광데이터 활용 공모전', 'contest@knto.or.kr'), subject: '[리마인드] 웹·앱 구현 부문 1차 심사 자료 제출 안내', snippet: '안녕하세요, 2026 관광데이터 활용 공모전 운영사무국입니다. 1차 심사(기능 심사) 자료 제출 기한이', hoursAgo: 75, labels: ['L_contest'] },
  { acc: N, from: a('네이버 카페', 'cafe@naver.com'), subject: '[맥북 사용자 모임] 새 댓글 3개', snippet: 'minji님의 글 "M5 맥북 에어 배터리 후기"에 새 댓글이 달렸습니다.', hoursAgo: 80, read: true, cat: 'CATEGORY_SOCIAL' },
  { acc: P, from: a('AI지니어스아카데미', 'academy@aigenius.kr'), subject: '[2026 AI지니어스 아카데미] 연구보고서 작성 안내', snippet: '연구보고서의 \'AI 미션 클리어\' 항목 작성 예시를 첨부드립니다.', hoursAgo: 120, read: true, files: [['보고서_예시.docx', 'application/msword', 88_000]] },
  { acc: S, from: a('정보부', 'it@school.example.kr'), subject: '학교 Wi-Fi 인증 방식 변경 안내', snippet: '10월 13일부터 학교 무선랜 인증이 Google Workspace 계정 기반으로 변경됩니다.', hoursAgo: 140, read: true },
  { acc: P, from: a('Apple', 'no_reply@email.apple.com'), subject: 'Apple Developer Program 멤버십 갱신 알림', snippet: '멤버십이 30일 후 만료됩니다. 갱신하여 앱 배포를 계속하세요.', hoursAgo: 170, read: true, cat: 'CATEGORY_UPDATES' },
  { acc: P, from: a('대전·논산 콘텐츠 경진대회', 'contest@djcontent.kr'), subject: '회원가입 완료 안내', snippet: '민지님, 회원가입이 완료되었습니다. 대회 접수는 10월 20일까지 가능합니다.', hoursAgo: 260, read: true },
  { acc: N, from: a('쿠팡', 'help@coupang.com'), subject: '로켓배송 상품이 도착했습니다', snippet: '고객님이 주문하신 상품이 문 앞에 배송 완료되었습니다.', hoursAgo: 300, read: true, cat: 'CATEGORY_UPDATES' },
  { acc: P, from: a('공학도서관AI', 'hello@mirigo.ai'), subject: '수행평가AI가 \'미리고\'로 업데이트 되었습니다', snippet: '안녕하세요, 김민지님. 나만의 수행평가 AI 비서, 더 빨라지고 똑똑해졌어요.', hoursAgo: 410, read: true, cat: 'CATEGORY_PROMOTIONS' },
  { acc: S, from: a('이수진 선생님', 'teacher.lee@school.example.kr'), subject: '정보올림피아드 대비반 신청', snippet: '희망 학생은 금요일까지 구글 폼으로 신청해 주세요.', hoursAgo: 500, read: true, labels: ['L_class'] }
]

const BODY = (s: Seed): string =>
  `<div style="font-family:-apple-system,sans-serif;font-size:14px;line-height:1.7;color:#222">
<p>안녕하세요, 김민지 님.</p>
<p>${s.snippet}</p>
<p>자세한 내용은 아래를 확인해 주세요.</p>
<ul><li>일정: 10월 10일(금) 18:00까지</li><li>문의: 회신 메일 또는 담당자 연락처</li></ul>
<p>감사합니다.<br/><b>${s.from.name}</b> 드림</p></div>`

/** Bump when the seed data changes: an existing demo profile is then wiped and re-seeded. */
const DEMO_SEED_VERSION = 2

export function seedDemo(repo: Repo): void {
  if (repo.accountRows().length) {
    if (repo.getKv<number>('demo.seedVersion', 1) === DEMO_SEED_VERSION) return
    for (const acc of ACCOUNTS) repo.deleteAccount(acc.id)
    if (repo.accountRows().length) return // not a pure demo profile: leave it alone
  }
  repo.setKv('demo.seedVersion', DEMO_SEED_VERSION)
  const now = Date.now()
  for (const acc of ACCOUNTS) {
    repo.insertAccount({ ...acc, config_json: '{}', secret: null, oauth_client_id: null })
    repo.replaceMailboxes(acc.id, [...SYSTEM, ...LABELS[acc.id]])
  }
  const me = (acc: string): Address => ({ name: '김민지', email: ACCOUNTS.find((x) => x.id === acc)!.email })
  // repeat the seed list a few times so the list scrolls and has date groups
  const list: { seed: Seed; i: number; date: number }[] = []
  for (let round = 0; round < 4; round++)
    SEEDS.forEach((seed, i) => list.push({ seed, i: round * 100 + i, date: now - (seed.hoursAgo + round * 24 * 21) * 3600_000 }))

  const byAcc = new Map<string, MessageUpsert[]>()
  const bodies: { acc: string; remoteId: string; html: string; text: string }[] = []
  for (const { seed, i, date } of list) {
    const remoteId = `m${i}`
    const read = seed.read ?? false
    const mb = ['INBOX', ...(seed.cat ? [seed.cat] : []), ...(seed.labels ?? []), ...(seed.star ? ['STARRED'] : [])]
    const msg: MessageUpsert = {
      remoteId,
      threadId: seed.thread && i < 100 ? `t${seed.thread}` : `t${i}`,
      subject: seed.subject,
      from: seed.from,
      to: [me(seed.acc)],
      cc: [],
      replyTo: [],
      snippet: seed.snippet,
      date,
      isRead: i >= 100 ? true : read,
      isStarred: !!seed.star,
      hasAttachments: !!seed.files,
      attachments: (seed.files ?? []).map(([filename, mimeType, size], k) => ({ id: `a${k}`, filename, mimeType, size })),
      messageIdHeader: `<${remoteId}@demo>`,
      inReplyTo: null,
      references: null,
      size: 4000,
      mailboxIds: mb.map((r) => mailboxId(seed.acc, r))
    }
    if (!byAcc.has(seed.acc)) byAcc.set(seed.acc, [])
    byAcc.get(seed.acc)!.push(msg)
    bodies.push({ acc: seed.acc, remoteId, html: BODY(seed), text: seed.snippet })
  }
  // a sent reply so thread 3 shows a conversation
  byAcc.get(P)!.push({
    ...byAcc.get(P)!.find((m) => m.threadId === 't3')!,
    remoteId: 'sent-1',
    from: me(P),
    to: [a('이도윤', 'doyoon.lee@gmail.com')],
    subject: 'Re: 해커톤 팀 구성 관련',
    snippet: '목요일 저녁 8시 좋아요. 디스코드에서 봬요!',
    date: now - 20 * 3600_000,
    isRead: true,
    mailboxIds: [mailboxId(P, 'SENT')]
  })
  for (const [acc, msgs] of byAcc) {
    const ids = repo.upsertMessages(acc, msgs)
    msgs.forEach((m, k) => {
      const b = bodies.find((x) => x.acc === acc && x.remoteId === m.remoteId)
      if (b) repo.putBody(ids[k], { html: b.html, text: b.text, attachments: m.attachments }, b.text)
    })
  }
}
