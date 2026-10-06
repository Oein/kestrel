import { useEffect, useState } from 'react'
import type { ImapAccountInput, ImapPreset, ImapPresetInfo, ImapTestResult, OAuthClient } from '../../../shared/types'
import { api, refreshAccounts, toast, useStore } from '../store'
import { setPref, usePrefs } from '../lib/prefs'
import { setReadingPane } from '../store'
import { Icon, type IconName } from './Icon'
import { editAccountLook } from './AccountLook'
import { confirmDialog } from './Confirm'
import { GeneralSettings } from './GeneralSettings'
import { OAuthClientForm, OAuthClientsPanel, OAuthHelp } from './OAuthClients'
import { RulesPanel } from './RulesPanel'
import { AccountMark, btn, cx, IconButton, inputCls } from './ui'

export function Modal(props: {
  title: string
  onClose: () => void
  children: React.ReactNode
  width?: number
  subtitle?: string
  onBack?: () => void
  bare?: boolean
  closing?: boolean
}): React.JSX.Element {
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') props.onClose()
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [props])
  return (
    <div
      className={cx(
        'fixed inset-0 z-50 flex items-center justify-center bg-black/25 p-6 dark:bg-black/45',
        props.closing ? 'animate-fade-out pointer-events-none' : 'animate-fade'
      )}
      onMouseDown={props.onClose}
    >
      <div
        className={cx(props.closing ? 'animate-pop-out' : 'animate-rise', 'flex max-h-full w-full flex-col overflow-hidden rounded-2xl border border-line bg-raised shadow-float')}
        style={{ maxWidth: props.width ?? 480 }}
        onMouseDown={(e) => e.stopPropagation()}
        onKeyDown={(e) => e.stopPropagation()}
      >
        {props.bare ? (
          props.children
        ) : (
          <>
            <div className="flex items-start gap-2 px-5 pb-1 pt-4">
              {props.onBack && <IconButton icon="back" title="뒤로" onClick={props.onBack} className="-ml-1.5 mt-[-2px]" />}
              <div className="min-w-0 flex-1">
                <h2 className="text-[15px] font-semibold tracking-[-0.01em]">{props.title}</h2>
                {props.subtitle && <p className="mt-0.5 text-[12.5px] text-ink-3">{props.subtitle}</p>}
              </div>
              <IconButton icon="close" title="닫기 (Esc)" onClick={props.onClose} className="-mr-1.5 mt-[-2px]" />
            </div>
            <div className="selectable overflow-y-auto px-5 pb-5 pt-3">{props.children}</div>
          </>
        )}
      </div>
    </div>
  )
}

type Choice = 'gmail' | ImapPreset

const PROVIDERS: { id: Choice; label: string; desc: string; icon?: IconName; mono?: string; tint: string }[] = [
  { id: 'gmail', label: 'Gmail', desc: 'Google 계정 · Gmail API로 빠르게 동기화', mono: 'G', tint: '#ea4335' },
  { id: 'icloud', label: 'iCloud 메일', desc: '앱 전용 비밀번호로 연결', icon: 'cloud', tint: '#3d8ef7' },
  { id: 'naver', label: '네이버 메일', desc: 'IMAP 사용 설정 후 연결', mono: 'N', tint: '#03c75a' },
  { id: 'custom', label: '다른 메일 서버', desc: 'IMAP · SMTP 직접 입력', icon: 'server', tint: 'var(--ink-3)' }
]

export function AddAccountDialog({ closing }: { closing?: boolean }): React.JSX.Element {
  const [choice, setChoice] = useState<Choice | null>(null)
  const close = (): void => useStore.setState({ addAccountOpen: false })
  const current = PROVIDERS.find((p) => p.id === choice)
  return (
    <Modal
      title={current ? `${current.label} 연결` : '계정 추가'}
      subtitle={current ? current.desc : '연결할 메일 서비스를 선택하세요'}
      onBack={choice ? () => setChoice(null) : undefined}
      onClose={close}
      width={choice ? 480 : 440}
      closing={closing}
    >
      {!choice ? (
        <div className="-mx-1.5 space-y-0.5">
          {PROVIDERS.map((p) => (
            <button
              key={p.id}
              onClick={() => setChoice(p.id)}
              className="group flex w-full items-center gap-3 rounded-xl px-2.5 py-2.5 text-left transition-colors hover:bg-hover"
            >
              <span
                className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[10px] border border-line bg-surface text-[15px] font-bold"
                style={{ color: p.tint }}
              >
                {p.icon ? <Icon name={p.icon} size={17} /> : p.mono}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-[13.5px] font-semibold text-ink">{p.label}</span>
                <span className="block text-[12px] text-ink-3">{p.desc}</span>
              </span>
              <Icon name="chevronRight" size={15} className="text-ink-3 transition-transform group-hover:translate-x-0.5" />
            </button>
          ))}
        </div>
      ) : choice === 'gmail' ? (
        <GmailForm onBack={() => setChoice(null)} onDone={close} />
      ) : (
        <ImapForm preset={choice} onBack={() => setChoice(null)} onDone={close} />
      )}
    </Modal>
  )
}

function GmailForm({ onBack, onDone }: { onBack: () => void; onDone: () => void }): React.JSX.Element {
  const [email, setEmail] = useState('')
  const [clients, setClients] = useState<OAuthClient[] | null>(null)
  const [clientId, setClientId] = useState<string>('')
  const [manual, setManual] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [addingClient, setAddingClient] = useState(false)

  const reloadClients = (): void => void api.oauthClients.list().then(setClients)
  useEffect(reloadClients, [])

  // auto-pick by domain unless the user chose manually
  useEffect(() => {
    if (manual || !clients?.length) return
    const t = setTimeout(() => void api.oauthClients.pick(email).then((id) => setClientId(id ?? '')), 120)
    return () => clearTimeout(t)
  }, [email, clients, manual])

  if (clients === null) return <div className="h-24" />

  if (clients.length === 0 || addingClient) {
    return (
      <div className="space-y-4">
        <p className="text-[12.5px] leading-relaxed text-ink-2">
          Gmail 계정을 연결하려면 먼저 Google OAuth 클라이언트를 등록해야 합니다.
        </p>
        <OAuthHelp />
        <OAuthClientForm
          forceDefault={clients.length === 0}
          onCancel={clients.length ? () => setAddingClient(false) : onBack}
          onSaved={(c) => {
            setAddingClient(false)
            setManual(true)
            setClientId(c.id)
            reloadClients()
          }}
        />
      </div>
    )
  }

  const start = async (): Promise<void> => {
    setBusy(true)
    setError(null)
    try {
      const acc = await api.accounts.addGmail({ email: email.trim() || undefined, oauthClientId: clientId || undefined })
      toast('success', `${acc.email} 계정을 추가했습니다.`)
      await refreshAccounts()
      onDone()
    } catch (e) {
      const msg = (e as Error).message
      if (msg === 'NO_OAUTH_CLIENT') setAddingClient(true)
      else setError(msg)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="space-y-4">
      <label className="block">
        <span className="mb-1.5 block text-[12px] font-medium text-ink-2">Gmail 주소 (선택)</span>
        <input
          autoFocus
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="name@gmail.com"
          className={inputCls}
          onKeyDown={(e) => e.key === 'Enter' && !busy && void start()}
        />
      </label>
      <label className="block">
        <span className="mb-1.5 block text-[12px] font-medium text-ink-2">OAuth 클라이언트</span>
        <div className="flex gap-2">
          <select
            value={clientId}
            onChange={(e) => {
              setManual(true)
              setClientId(e.target.value)
            }}
            className={`${inputCls} cursor-default`}
          >
            {clients.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
                {c.isDefault ? ' (기본)' : ''}
                {c.domains.length ? ` — @${c.domains.join(', @')}` : ''}
              </option>
            ))}
          </select>
          <button className={cx(btn.secondary, 'w-9 shrink-0 px-0')} onClick={() => setAddingClient(true)} title="클라이언트 추가">
            <Icon name="plus" size={15} />
          </button>
        </div>
        {!manual && <span className="mt-1.5 block text-[12px] text-ink-3">이메일 도메인에 맞는 클라이언트가 자동으로 선택됩니다.</span>}
      </label>
      {busy && (
        <div className="flex items-center gap-2.5 rounded-xl bg-accent-soft px-3.5 py-3 text-[12.5px] text-ink">
          <Icon name="spinner" size={14} className="text-accent" />
          <span className="flex-1">브라우저에서 Google 로그인을 완료하세요</span>
          <button className={btn.link} onClick={() => void api.accounts.cancelGmailAuth()}>
            취소
          </button>
        </div>
      )}
      {error && <div className="rounded-xl bg-danger/10 px-3.5 py-3 text-[12.5px] text-danger">{error}</div>}
      <div className="flex justify-end gap-2 pt-1">
        <button className={btn.ghost} onClick={onBack}>
          취소
        </button>
        <button className={btn.primary} disabled={busy} onClick={() => void start()}>
          Google로 로그인
          <Icon name="openExt" size={13} />
        </button>
      </div>
    </div>
  )
}

function ImapForm({ preset, onBack, onDone }: { preset: ImapPreset; onBack: () => void; onDone: () => void }): React.JSX.Element {
  const [info, setInfo] = useState<ImapPresetInfo | null>(null)
  const [form, setForm] = useState<ImapAccountInput | null>(null)
  const [busy, setBusy] = useState<'test' | 'add' | null>(null)
  const [result, setResult] = useState<ImapTestResult | null>(null)

  useEffect(() => {
    void api.accounts.presets().then((list) => {
      const p = list.find((x) => x.id === preset)!
      setInfo(p)
      setForm({ preset, email: '', name: '', username: '', password: '', imap: { ...p.imap }, smtp: { ...p.smtp } })
    })
  }, [preset])

  if (!info || !form) return <div className="h-24" />
  const upd = (patch: Partial<ImapAccountInput>): void => {
    setResult(null)
    setForm({ ...form, ...patch })
  }
  const onEmail = (email: string): void => {
    const username = preset === 'naver' ? email.split('@')[0] : email
    upd({ email, username: form.username && form.username !== (preset === 'naver' ? form.email.split('@')[0] : form.email) ? form.username : username })
  }

  const test = async (): Promise<ImapTestResult | null> => {
    setBusy('test')
    try {
      const r = await api.accounts.testImap(form)
      setResult(r)
      return r
    } catch (e) {
      toast('error', (e as Error).message)
      return null
    } finally {
      setBusy(null)
    }
  }

  const add = async (): Promise<void> => {
    const r = result?.ok ? result : await test()
    if (!r?.ok) return
    setBusy('add')
    try {
      const acc = await api.accounts.addImap(form)
      toast('success', `${acc.email} 계정을 추가했습니다.`)
      await refreshAccounts()
      onDone()
    } catch (e) {
      toast('error', (e as Error).message)
    } finally {
      setBusy(null)
    }
  }

  const server = (kind: 'imap' | 'smtp'): React.JSX.Element => (
    <div className="grid grid-cols-[1fr_80px_120px] gap-2">
      <input
        value={form[kind].host}
        onChange={(e) => upd({ [kind]: { ...form[kind], host: e.target.value } } as Partial<ImapAccountInput>)}
        placeholder={`${kind.toUpperCase()} 서버`}
        className={inputCls}
      />
      <input
        value={form[kind].port}
        onChange={(e) => upd({ [kind]: { ...form[kind], port: Number(e.target.value) || 0 } } as Partial<ImapAccountInput>)}
        className={inputCls}
      />
      <select
        value={form[kind].secure ? 'tls' : 'starttls'}
        onChange={(e) => upd({ [kind]: { ...form[kind], secure: e.target.value === 'tls' } } as Partial<ImapAccountInput>)}
        className={`${inputCls} cursor-default`}
      >
        <option value="tls">SSL/TLS</option>
        <option value="starttls">STARTTLS</option>
      </select>
    </div>
  )

  return (
    <div className="space-y-3">
      <div className="flex gap-3 rounded-xl border border-line bg-surface px-3.5 py-3 text-[12.5px] leading-relaxed text-ink-2">
        <Icon name="key" size={15} className="mt-0.5 text-warn" />
        <div>
          {info.hint}
          {info.link && (
            <button className="ml-1 font-medium text-accent hover:underline" onClick={() => void api.app.openExternal(info.link!)}>
              {info.link.replace('https://', '')}
            </button>
          )}
        </div>
      </div>
      <input autoFocus value={form.name} onChange={(e) => upd({ name: e.target.value })} placeholder="이름 (보낸사람 표시 이름)" className={inputCls} />
      <input value={form.email} onChange={(e) => onEmail(e.target.value)} placeholder="이메일 주소" className={inputCls} />
      <input value={form.username} onChange={(e) => upd({ username: e.target.value })} placeholder="사용자 이름" className={inputCls} />
      <input
        type="password"
        value={form.password}
        onChange={(e) => upd({ password: e.target.value })}
        placeholder={preset === 'custom' ? '비밀번호' : '앱 비밀번호'}
        className={inputCls}
      />
      {preset === 'custom' && (
        <div className="space-y-2 pt-1">
          <div className="text-[12px] font-medium text-ink-2">수신 (IMAP)</div>
          {server('imap')}
          <div className="text-[12px] font-medium text-ink-2">발신 (SMTP)</div>
          {server('smtp')}
        </div>
      )}
      {result && (
        <div className="space-y-1 rounded-xl border border-line bg-surface px-3.5 py-3 text-[12.5px]">
          {(['imap', 'smtp'] as const).map((k) => (
            <div key={k} className="flex items-start gap-2">
              <Icon name={result[k] ? 'warning' : 'check'} size={14} className={cx('mt-0.5', result[k] ? 'text-danger' : 'text-ok')} />
              <span className="font-semibold">{k.toUpperCase()}</span>
              <span className={result[k] ? 'text-danger' : 'text-ink-2'}>{result[k] ? result[k] : '연결 성공'}</span>
            </div>
          ))}
        </div>
      )}
      <div className="flex justify-between pt-1">
        <button className={btn.ghost} onClick={onBack}>
          취소
        </button>
        <div className="flex gap-2">
          <button className={btn.secondary} disabled={!!busy || !form.email || !form.password} onClick={() => void test()}>
            {busy === 'test' ? '테스트 중...' : '연결 테스트'}
          </button>
          <button className={btn.primary} disabled={!!busy || !form.email || !form.password} onClick={() => void add()}>
            {busy === 'add' ? '추가 중...' : '추가'}
          </button>
        </div>
      </div>
    </div>
  )
}

type SettingsTab = 'general' | 'accounts' | 'oauth' | 'rules' | 'shortcuts'

const TABS: { id: SettingsTab; label: string; icon: IconName }[] = [
  { id: 'general', label: '일반', icon: 'settings' },
  { id: 'accounts', label: '계정', icon: 'person' },
  { id: 'oauth', label: 'OAuth 클라이언트', icon: 'key' },
  { id: 'rules', label: '자동 분류', icon: 'label' },
  { id: 'shortcuts', label: '단축키', icon: 'command' }
]

/** Open settings on a specific tab (e.g. '?' opens the shortcut list). The tray/menu deep-link uses the same store field. */
export function openSettings(tab: SettingsTab = 'general'): void {
  useStore.setState({ settingsOpen: true, settingsTab: tab, paletteOpen: false })
}

export function SettingsDialog({ closing }: { closing?: boolean }): React.JSX.Element {
  const requested = useStore((s) => s.settingsTab)
  const [tab, setTab] = useState<SettingsTab>('general')
  useEffect(() => {
    if (requested && TABS.some((t) => t.id === requested)) setTab(requested as SettingsTab)
  }, [requested])
  const close = (): void => useStore.setState({ settingsOpen: false, settingsTab: null })
  const current = TABS.find((t) => t.id === tab)!
  return (
    <Modal title="설정" onClose={close} width={820} bare closing={closing}>
      <div className="flex h-[min(600px,82vh)]">
        <nav className="flex w-[196px] shrink-0 flex-col gap-px border-r border-line bg-hover p-2.5">
          <div className="px-2 pb-2 pt-1.5 text-[13px] font-semibold">설정</div>
          {TABS.map((t) => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={cx(
                'flex h-[30px] items-center gap-2.5 rounded-md px-2 text-left text-[13px]',
                tab === t.id ? 'bg-active font-medium text-ink' : 'text-ink-2 hover:bg-hover hover:text-ink'
              )}
            >
              <Icon name={t.icon} size={15} className={tab === t.id ? 'text-accent' : 'text-ink-3'} />
              {t.label}
            </button>
          ))}
        </nav>
        <div className="flex min-w-0 flex-1 flex-col">
          <div className="flex h-12 shrink-0 items-center pl-6 pr-3">
            <h2 className="flex-1 text-[15px] font-semibold">{current.label}</h2>
            <IconButton icon="close" title="닫기 (Esc)" onClick={close} />
          </div>
          <div key={tab} className="animate-slide-up selectable min-h-0 flex-1 overflow-y-auto px-6 pb-6">
            {tab === 'general' && <GeneralTab />}
            {tab === 'accounts' && <AccountsTab />}
            {tab === 'oauth' && <OAuthClientsPanel />}
            {tab === 'rules' && <RulesPanel />}
            {tab === 'shortcuts' && <ShortcutHelp />}
          </div>
        </div>
      </div>
    </Modal>
  )
}

/** Section of settings rows. */
export function SettingGroup({ title, children }: { title?: string; children: React.ReactNode }): React.JSX.Element {
  return (
    <section className="mb-6">
      {title && <h3 className="mb-2 text-[11.5px] font-semibold tracking-wide text-ink-3">{title}</h3>}
      <div className="divide-y divide-line rounded-xl border border-line bg-surface">{children}</div>
    </section>
  )
}

export function SettingRow({ label, desc, children }: { label: string; desc?: string; children: React.ReactNode }): React.JSX.Element {
  return (
    <div className="flex min-h-[52px] items-center gap-4 px-4 py-2.5">
      <div className="min-w-0 flex-1">
        <div className="text-[13px] font-medium text-ink">{label}</div>
        {desc && <div className="mt-0.5 text-[12px] text-ink-3">{desc}</div>}
      </div>
      {children}
    </div>
  )
}

export function Segmented<T extends string>(props: { value: T; options: { value: T; label: string }[]; onChange: (v: T) => void }): React.JSX.Element {
  return (
    <div className="flex rounded-lg bg-hover p-0.5">
      {props.options.map((o) => (
        <button
          key={o.value}
          onClick={() => props.onChange(o.value)}
          className={cx(
            'h-[26px] rounded-md px-3 text-[12px] font-medium',
            props.value === o.value ? 'bg-surface text-ink shadow-[0_1px_2px_rgba(0,0,0,.08),0_0_0_0.5px_var(--line-strong)]' : 'text-ink-3 hover:text-ink-2'
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}

function GeneralTab(): React.JSX.Element {
  const density = usePrefs((s) => s.density)
  const readingPane = useStore((s) => s.readingPane)
  return (
    <>
      <SettingGroup title="보기">
        <SettingRow label="목록 밀도" desc="컴팩트는 한 화면에 더 많은 메일을 보여 줍니다">
          <Segmented
            value={density}
            onChange={(v) => setPref('density', v)}
            options={[
              { value: 'comfortable', label: '기본' },
              { value: 'compact', label: '컴팩트' }
            ]}
          />
        </SettingRow>
        <SettingRow label="읽기 창" desc="목록 옆에 메일을 바로 엽니다">
          <Segmented
            value={readingPane ? 'on' : 'off'}
            onChange={(v) => setReadingPane(v === 'on')}
            options={[
              { value: 'on', label: '오른쪽' },
              { value: 'off', label: '끄기' }
            ]}
          />
        </SettingRow>
      </SettingGroup>
      <GeneralSettings />
    </>
  )
}


function AccountsTab(): React.JSX.Element {
  const accounts = useStore((s) => s.accounts)
  const statuses = useStore((s) => s.statuses)
  return (
    <div className="space-y-2">
      {accounts.map((a) => {
        const st = statuses[a.id]
        return (
          <div key={a.id} className="flex items-center gap-3 rounded-xl border border-line bg-surface px-4 py-3">
            <button title="아이콘 바꾸기" onClick={() => editAccountLook(a.id)} className="rounded-[9px] hover:opacity-80">
              <AccountMark id={a.id} email={a.email} color={a.color} size={28} />
            </button>
            <div className="min-w-0 flex-1">
              <div className="truncate text-[13px] font-semibold">{a.email}</div>
              <div className="mt-0.5 flex items-center gap-2 text-[12px] text-ink-3">
                {a.provider === 'gmail' ? 'Gmail API' : a.preset === 'icloud' ? 'iCloud · IMAP' : a.preset === 'naver' ? '네이버 · IMAP' : 'IMAP'}
                {a.needsReauth ? (
                  <span className="font-medium text-warn">재로그인 필요</span>
                ) : st?.state === 'error' ? (
                  <span className="truncate text-danger">오류: {st.message}</span>
                ) : st?.state === 'syncing' ? (
                  <span>동기화 중</span>
                ) : null}
              </div>
            </div>
            {a.provider === 'gmail' && (
              <button
                className={btn.link}
                onClick={() =>
                  api.accounts
                    .reauth(a.id)
                    .then(() => toast('success', '다시 로그인했습니다.'))
                    .catch((e: Error) => toast('error', e.message === 'NO_OAUTH_CLIENT' ? 'OAuth 클라이언트를 먼저 등록하세요.' : e.message))
                }
              >
                다시 로그인
              </button>
            )}
            <button className={btn.link} onClick={() => void api.sync.now(a.id)}>
              동기화
            </button>
            <button
              className={btn.danger}
              onClick={async () => {
                const ok = await confirmDialog({
                  title: `${a.email} 계정을 삭제할까요?`,
                  message: '이 기기에 저장된 메일도 함께 삭제됩니다. 서버의 메일은 그대로 남습니다.',
                  confirmLabel: '계정 삭제',
                  danger: true
                })
                if (ok) void api.accounts.remove(a.id)
              }}
            >
              삭제
            </button>
          </div>
        )
      })}
      <button className={btn.secondary} onClick={() => useStore.setState({ settingsOpen: false, addAccountOpen: true })}>
        <Icon name="plus" size={14} />
        계정 추가
      </button>
    </div>
  )
}

export const SHORTCUTS: [string, string[]][] = [
  ['새 메일', ['C']],
  ['검색', ['/']],
  ['명령 팔레트', ['⌘', 'K']],
  ['단축키 보기', ['?']],
  ['설정', ['⌘', ',']],
  ['계정 전환 (모든 계정 / 1번째…)', ['⌘', '1–9']],
  ['다음 / 이전 대화', ['J', 'K']],
  ['대화 열기', ['O']],
  ['목록으로', ['U']],
  ['보관', ['E']],
  ['삭제', ['#']],
  ['삭제', ['⌘', '⌫']],
  ['전체 선택 (본문에서는 본문 텍스트)', ['⌘', 'A']],
  ['별표', ['S']],
  ['선택', ['X']],
  ['범위 선택', ['⇧', '클릭']],
  ['읽음으로 표시', ['⇧', 'I']],
  ['읽지 않음으로 표시', ['⇧', 'U']],
  ['답장', ['R']],
  ['전체답장', ['A']],
  ['전달', ['F']],
  ['실행취소', ['Z']],
  ['받은편지함', ['G', 'I']],
  ['별표', ['G', 'S']],
  ['보낸편지함', ['G', 'T']],
  ['임시보관함', ['G', 'D']],
  ['전체 메일', ['G', 'A']],
  ['안 읽은 메일만 보기', ['G', 'U']],
  ['보내기 (작성 중)', ['⌘', '↵']]
]

function ShortcutHelp(): React.JSX.Element {
  return (
    <div className="grid grid-cols-2 gap-x-8">
      {SHORTCUTS.map(([d, keys]) => (
        <div key={d + keys.join()} className="flex h-9 items-center justify-between gap-3 border-b border-line text-[13px]">
          <span className="text-ink-2">{d}</span>
          <span className="flex gap-1">
            {keys.map((k) => (
              <kbd key={k}>{k}</kbd>
            ))}
          </span>
        </div>
      ))}
    </div>
  )
}

export function ReauthBanner(): React.JSX.Element | null {
  const accounts = useStore((s) => s.accounts)
  const [busy, setBusy] = useState<string | null>(null)
  const need = accounts.filter((a) => a.needsReauth)
  if (!need.length) return null
  return (
    <div className="flex shrink-0 flex-col border-b border-line">
      {need.map((a) => (
        <div key={a.id} className="flex h-10 items-center gap-2.5 bg-warn/10 px-4 text-[12.5px]">
          <Icon name="warning" size={14} className="text-warn" />
          <span className="min-w-0 flex-1 truncate text-ink-2">
            <b className="font-semibold text-ink">{a.email}</b> 로그인이 만료되었습니다. 저장된 메일은 계속 볼 수 있습니다.
          </span>
          <button
            disabled={busy === a.id}
            className={cx(btn.secondary, 'h-7 px-2.5 text-[12px]')}
            onClick={() => {
              setBusy(a.id)
              api.accounts
                .reauth(a.id)
                .then(() => toast('success', '다시 로그인했습니다.'))
                .catch((e: Error) => toast('error', e.message === 'NO_OAUTH_CLIENT' ? 'OAuth 클라이언트를 먼저 등록하세요.' : e.message))
                .finally(() => setBusy(null))
            }}
          >
            {busy === a.id ? '브라우저에서 로그인 중…' : '다시 로그인'}
          </button>
        </div>
      ))}
    </div>
  )
}
