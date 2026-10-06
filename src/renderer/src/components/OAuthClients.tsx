import { useEffect, useState } from 'react'
import type { OAuthClient, OAuthClientInput } from '../../../shared/types'
import { api, toast } from '../store'
import { Icon } from './Icon'
import { confirmDialog } from './Confirm'
import { btn, Checkbox, inputCls } from './ui'

export function OAuthHelp(): React.JSX.Element {
  const link = (href: string, label: string): React.JSX.Element => (
    <a
      href={href}
      onClick={(e) => {
        e.preventDefault()
        void api.app.openExternal(href)
      }}
      className="font-medium text-accent hover:underline"
    >
      {label}
    </a>
  )
  return (
    <details className="group rounded-xl border border-line bg-surface px-4 py-3 text-[12.5px] leading-relaxed text-ink-2">
      <summary className="flex cursor-default list-none items-center gap-2 font-semibold text-ink"><Icon name="chevronRight" size={13} className="text-ink-3 transition-transform group-open:rotate-90" />Google OAuth 클라이언트 만드는 방법</summary>
      <ol className="mt-2.5 list-decimal space-y-1.5 pl-5 marker:text-ink-3">
        <li>{link('https://console.cloud.google.com/projectcreate', 'Google Cloud 콘솔')}에서 프로젝트를 만듭니다.</li>
        <li>
          {link('https://console.cloud.google.com/apis/library/gmail.googleapis.com', 'Gmail API')}를 사용 설정합니다.
        </li>
        <li>
          OAuth 동의 화면(Google Auth Platform)을 구성합니다. 개인 @gmail.com 계정은 <b>외부 + 테스트</b> 모드로 두고 본인을
          테스트 사용자로 추가하세요. Google Workspace(학교·회사) 도메인은 <b>내부</b>로 만들면 해당 도메인 사용자만 쓸 수 있습니다.
        </li>
        <li>
          {link('https://console.cloud.google.com/apis/credentials', '사용자 인증 정보')} → OAuth 클라이언트 ID 만들기 →
          애플리케이션 유형 <b>데스크톱 앱</b>을 선택합니다.
        </li>
        <li>생성된 클라이언트 ID와 보안 비밀번호를 아래에 붙여넣습니다.</li>
      </ol>
      <p className="mt-2.5 text-ink-3">
        참고: 테스트 모드 앱의 refresh token은 7일 후 만료됩니다. 만료되면 계정 옆에 &quot;재로그인 필요&quot;가 표시되며, 한 번
        클릭으로 다시 로그인할 수 있습니다(캐시된 메일은 계속 볼 수 있습니다).
      </p>
    </details>
  )
}

export function OAuthClientForm(props: {
  initial?: OAuthClient
  onSaved: (c: OAuthClient) => void
  onCancel?: () => void
  forceDefault?: boolean
}): React.JSX.Element {
  const { initial } = props
  const [name, setName] = useState(initial?.name ?? '')
  const [clientId, setClientId] = useState(initial?.clientId ?? '')
  const [secret, setSecret] = useState('')
  const [domains, setDomains] = useState(initial?.domains.join(', ') ?? '')
  const [isDefault, setIsDefault] = useState(initial?.isDefault ?? !!props.forceDefault)
  const [busy, setBusy] = useState(false)

  const save = async (): Promise<void> => {
    setBusy(true)
    try {
      const input: OAuthClientInput = {
        id: initial?.id,
        name: name || '내 OAuth 클라이언트',
        clientId,
        clientSecret: secret,
        domains: domains.split(',').map((d) => d.trim()).filter(Boolean),
        isDefault
      }
      const saved = await api.oauthClients.save(input)
      toast('success', 'OAuth 클라이언트를 저장했습니다.')
      props.onSaved(saved)
    } catch (e) {
      toast('error', (e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="space-y-3">
      <label className="block">
        <span className="mb-1.5 block text-[12px] font-medium text-ink-2">이름</span>
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="예: 개인 Gmail" className={inputCls} />
      </label>
      <label className="block">
        <span className="mb-1.5 block text-[12px] font-medium text-ink-2">클라이언트 ID</span>
        <input
          value={clientId}
          onChange={(e) => setClientId(e.target.value)}
          placeholder="xxxxxxxx.apps.googleusercontent.com"
          className={`${inputCls} font-mono text-[12px]`}
          spellCheck={false}
        />
      </label>
      <label className="block">
        <span className="mb-1.5 block text-[12px] font-medium text-ink-2">
          클라이언트 보안 비밀번호 {initial?.hasSecret && <span className="font-normal text-ink-3">(비워두면 기존 값 유지)</span>}
        </span>
        <input
          type="password"
          value={secret}
          onChange={(e) => setSecret(e.target.value)}
          placeholder={initial?.hasSecret ? '••••••••' : 'GOCSPX-...'}
          className={`${inputCls} font-mono text-[12px]`}
          spellCheck={false}
        />
      </label>
      <label className="block">
        <span className="mb-1.5 block text-[12px] font-medium text-ink-2">도메인 (선택, 쉼표로 구분)</span>
        <input value={domains} onChange={(e) => setDomains(e.target.value)} placeholder="예: school.ac.kr" className={inputCls} />
        <span className="mt-1.5 block text-[12px] text-ink-3">이 도메인의 주소를 추가할 때 자동으로 이 클라이언트를 사용합니다.</span>
      </label>
      <div className="flex items-center gap-2 text-[13px] text-ink-2">
        <Checkbox checked={isDefault} onChange={() => setIsDefault(!isDefault)} />
        <span onClick={() => setIsDefault(!isDefault)}>기본 클라이언트로 사용</span>
      </div>
      <div className="flex justify-end gap-2 pt-1">
        {props.onCancel && (
          <button className={btn.ghost} onClick={props.onCancel}>
            취소
          </button>
        )}
        <button className={btn.primary} disabled={busy || !clientId.trim()} onClick={() => void save()}>
          저장
        </button>
      </div>
    </div>
  )
}

export function OAuthClientsPanel(): React.JSX.Element {
  const [clients, setClients] = useState<OAuthClient[]>([])
  const [editing, setEditing] = useState<OAuthClient | 'new' | null>(null)
  const reload = (): void => void api.oauthClients.list().then(setClients)
  useEffect(reload, [])

  if (editing) {
    return (
      <div className="space-y-4">
        <OAuthHelp />
        <OAuthClientForm
          initial={editing === 'new' ? undefined : editing}
          forceDefault={clients.length === 0}
          onCancel={() => setEditing(null)}
          onSaved={() => {
            setEditing(null)
            reload()
          }}
        />
      </div>
    )
  }

  return (
    <div className="space-y-3">
      <p className="text-[12.5px] leading-relaxed text-ink-2">
        Gmail 계정 로그인에 사용할 Google OAuth 클라이언트입니다. 개인 계정용과 Workspace 도메인용 등 여러 개를 등록할 수 있습니다.
      </p>
      {clients.length === 0 && (
        <div className="rounded-xl border border-dashed border-line-strong p-6 text-center text-[12.5px] text-ink-3">
          등록된 클라이언트가 없습니다.
        </div>
      )}
      {clients.map((c) => (
        <div key={c.id} className="flex items-center gap-3 rounded-xl border border-line bg-surface px-4 py-3">
          <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-hover text-ink-2"><Icon name="key" size={15} /></span>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <span className="truncate text-[13px] font-semibold">{c.name}</span>
              {c.isDefault && <span className="rounded-md bg-accent-soft px-1.5 text-[11px] font-semibold leading-[18px] text-accent">기본</span>}
              {c.domains.map((d) => (
                <span key={d} className="rounded-md bg-hover px-1.5 text-[11px] leading-[18px] text-ink-2">
                  @{d}
                </span>
              ))}
            </div>
            <div className="mt-0.5 truncate font-mono text-[11px] text-ink-3">
              {c.clientId.slice(0, 18)}… · 계정 {c.accountCount}개{!c.hasSecret && ' · 보안 비밀번호 없음'}
            </div>
          </div>
          {!c.isDefault && (
            <button className={btn.link} onClick={() => void api.oauthClients.setDefault(c.id).then(reload)}>
              기본으로
            </button>
          )}
          <button className={btn.link} onClick={() => setEditing(c)}>
            편집
          </button>
          <button
            className={btn.danger}
            title={c.accountCount ? '이 클라이언트를 사용하는 계정이 있습니다' : '삭제'}
            onClick={async () => {
              if (!(await confirmDialog({ title: `"${c.name}" 클라이언트를 삭제할까요?`, confirmLabel: '삭제', danger: true }))) return
              api.oauthClients
                .remove(c.id)
                .then(reload)
                .catch((e: Error) => toast('error', e.message))
            }}
          >
            삭제
          </button>
        </div>
      ))}
      <button className={btn.secondary} onClick={() => setEditing('new')}>
        <Icon name="plus" size={14} />
        클라이언트 추가
      </button>
    </div>
  )
}
