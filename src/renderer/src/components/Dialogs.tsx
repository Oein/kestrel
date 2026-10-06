import { useEffect, useState } from 'react'
import type { ImapAccountInput, ImapPreset, ImapPresetInfo, ImapTestResult, OAuthClient } from '../../../shared/types'
import { api, refreshAccounts, toast, useStore } from '../store'
import { Icon } from './Icon'
import { btnGhost, btnPrimary, inputCls, OAuthClientForm, OAuthClientsPanel, OAuthHelp } from './OAuthClients'

export function Modal(props: { title: string; onClose: () => void; children: React.ReactNode; width?: number }): React.JSX.Element {
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') props.onClose()
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [props])
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-6" onMouseDown={props.onClose}>
      <div
        className="flex max-h-full w-full flex-col overflow-hidden rounded-2xl bg-white shadow-2xl dark:bg-[#1f2329]"
        style={{ maxWidth: props.width ?? 520 }}
        onMouseDown={(e) => e.stopPropagation()}
        onKeyDown={(e) => e.stopPropagation()}
      >
        <div className="flex items-center px-6 pb-2 pt-5">
          <h2 className="flex-1 text-[18px] font-medium">{props.title}</h2>
          <button onClick={props.onClose} className="rounded-full p-1.5 opacity-60 hover:bg-black/5 hover:opacity-100 dark:hover:bg-white/10">
            <Icon name="close" size={18} />
          </button>
        </div>
        <div className="selectable overflow-y-auto px-6 pb-6 pt-2">{props.children}</div>
      </div>
    </div>
  )
}

type Choice = 'gmail' | ImapPreset

export function AddAccountDialog(): React.JSX.Element {
  const [choice, setChoice] = useState<Choice | null>(null)
  const close = (): void => useStore.setState({ addAccountOpen: false })
  return (
    <Modal title="계정 추가" onClose={close}>
      {!choice ? (
        <div className="grid grid-cols-2 gap-3">
          {(
            [
              ['gmail', 'Gmail', 'Google 계정 (Gmail API)', '#ea4335'],
              ['icloud', 'iCloud', 'iCloud 메일 (IMAP)', '#3693f3'],
              ['naver', '네이버', '네이버 메일 (IMAP)', '#03c75a'],
              ['custom', '기타', 'IMAP/SMTP 직접 설정', '#8a8f98']
            ] as const
          ).map(([id, label, desc, color]) => (
            <button
              key={id}
              onClick={() => setChoice(id)}
              className="flex flex-col items-start gap-1 rounded-xl border border-black/10 p-4 text-left hover:border-[#0b57d0] hover:bg-[#0b57d0]/5 dark:border-white/10"
            >
              <span className="flex items-center gap-2 text-[15px] font-medium">
                <span className="h-3 w-3 rounded-full" style={{ background: color }} />
                {label}
              </span>
              <span className="text-[12px] opacity-60">{desc}</span>
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
        <p className="text-[13px] opacity-80">
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
        <span className="mb-1 block text-[13px] opacity-70">Gmail 주소 (선택)</span>
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
        <span className="mb-1 block text-[13px] opacity-70">OAuth 클라이언트</span>
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
          <button className={btnGhost} onClick={() => setAddingClient(true)} title="클라이언트 추가">
            +
          </button>
        </div>
        {!manual && <span className="mt-1 block text-[12px] opacity-50">이메일 도메인에 맞는 클라이언트가 자동으로 선택됩니다.</span>}
      </label>
      {busy && (
        <div className="rounded-lg bg-[#0b57d0]/10 px-4 py-3 text-[13px]">
          브라우저에서 Google 로그인을 완료하세요...
          <button className="ml-2 underline" onClick={() => void api.accounts.cancelGmailAuth()}>
            취소
          </button>
        </div>
      )}
      {error && <div className="rounded-lg bg-red-500/10 px-4 py-3 text-[13px] text-red-600 dark:text-red-400">{error}</div>}
      <div className="flex justify-between">
        <button className={btnGhost} onClick={onBack}>
          뒤로
        </button>
        <button className={btnPrimary} disabled={busy} onClick={() => void start()}>
          Google로 로그인
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
      <div className="flex gap-3 rounded-lg bg-amber-500/10 px-4 py-3 text-[13px] leading-relaxed">
        <Icon name="key" size={18} className="mt-0.5 text-amber-600" />
        <div>
          {info.hint}
          {info.link && (
            <button className="ml-1 text-[#0b57d0] underline dark:text-[#a8c7fa]" onClick={() => void api.app.openExternal(info.link!)}>
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
          <div className="text-[12px] font-medium opacity-60">수신 (IMAP)</div>
          {server('imap')}
          <div className="text-[12px] font-medium opacity-60">발신 (SMTP)</div>
          {server('smtp')}
        </div>
      )}
      {result && (
        <div className={`rounded-lg px-4 py-3 text-[13px] ${result.ok ? 'bg-emerald-500/10' : 'bg-red-500/10 text-red-600 dark:text-red-400'}`}>
          <div>IMAP: {result.imap ? `실패 — ${result.imap}` : '연결 성공'}</div>
          <div>SMTP: {result.smtp ? `실패 — ${result.smtp}` : '연결 성공'}</div>
        </div>
      )}
      <div className="flex justify-between pt-1">
        <button className={btnGhost} onClick={onBack}>
          뒤로
        </button>
        <div className="flex gap-2">
          <button className={btnGhost} disabled={!!busy || !form.email || !form.password} onClick={() => void test()}>
            {busy === 'test' ? '테스트 중...' : '연결 테스트'}
          </button>
          <button className={btnPrimary} disabled={!!busy || !form.email || !form.password} onClick={() => void add()}>
            {busy === 'add' ? '추가 중...' : '추가'}
          </button>
        </div>
      </div>
    </div>
  )
}

export function SettingsDialog(): React.JSX.Element {
  const [tab, setTab] = useState<'accounts' | 'oauth' | 'shortcuts'>('accounts')
  const accounts = useStore((s) => s.accounts)
  const statuses = useStore((s) => s.statuses)
  const close = (): void => useStore.setState({ settingsOpen: false })
  const tabBtn = (id: typeof tab, label: string): React.JSX.Element => (
    <button
      onClick={() => setTab(id)}
      className={`rounded-full px-4 py-1.5 text-[13px] ${tab === id ? 'bg-[#0b57d0] text-white' : 'hover:bg-black/5 dark:hover:bg-white/10'}`}
    >
      {label}
    </button>
  )
  return (
    <Modal title="설정" onClose={close} width={640}>
      <div className="mb-4 flex gap-1">
        {tabBtn('accounts', '계정')}
        {tabBtn('oauth', 'OAuth 클라이언트')}
        {tabBtn('shortcuts', '단축키')}
      </div>
      {tab === 'accounts' && (
        <div className="space-y-2">
          {accounts.map((a) => (
            <div key={a.id} className="flex items-center gap-3 rounded-lg border border-black/10 px-4 py-3 dark:border-white/10">
              <span className="h-3 w-3 rounded-full" style={{ background: a.color }} />
              <div className="min-w-0 flex-1">
                <div className="truncate font-medium">{a.email}</div>
                <div className="text-[12px] opacity-60">
                  {a.provider === 'gmail' ? 'Gmail' : a.preset === 'icloud' ? 'iCloud' : a.preset === 'naver' ? '네이버' : 'IMAP'}
                  {a.needsReauth && <span className="ml-2 text-amber-600">재로그인 필요</span>}
                  {!a.needsReauth && statuses[a.id]?.state === 'error' && (
                    <span className="ml-2 text-red-500">오류: {statuses[a.id]?.message}</span>
                  )}
                </div>
              </div>
              {a.provider === 'gmail' && (
                <button
                  className="text-[12px] opacity-70 hover:underline"
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
              <button className="text-[12px] opacity-70 hover:underline" onClick={() => void api.sync.now(a.id)}>
                동기화
              </button>
              <button
                className="text-[12px] text-red-600 opacity-80 hover:underline"
                onClick={() => {
                  if (confirm(`${a.email} 계정을 삭제할까요? 로컬에 저장된 메일도 삭제됩니다.`)) void api.accounts.remove(a.id)
                }}
              >
                삭제
              </button>
            </div>
          ))}
          <button className={btnGhost} onClick={() => useStore.setState({ settingsOpen: false, addAccountOpen: true })}>
            + 계정 추가
          </button>
        </div>
      )}
      {tab === 'oauth' && <OAuthClientsPanel />}
      {tab === 'shortcuts' && <ShortcutHelp />}
    </Modal>
  )
}

export const SHORTCUTS: [string, string][] = [
  ['c', '편지쓰기'],
  ['/', '검색'],
  ['⌘K', '명령 팔레트'],
  ['j / k', '다음 / 이전 대화'],
  ['o / Enter', '대화 열기'],
  ['u / Esc', '목록으로 돌아가기'],
  ['e', '보관'],
  ['#', '삭제'],
  ['s', '별표'],
  ['x', '선택'],
  ['Shift+I / Shift+U', '읽음 / 읽지 않음으로 표시'],
  ['r / a / f', '답장 / 전체답장 / 전달'],
  ['z', '실행취소'],
  ['g i / g s / g t', '받은편지함 / 별표편지함 / 보낸편지함'],
  ['g d / g a', '임시보관함 / 전체보관함'],
  ['⌘Enter', '(편지쓰기) 보내기']
]

function ShortcutHelp(): React.JSX.Element {
  return (
    <div className="grid grid-cols-2 gap-x-6 gap-y-2 text-[13px]">
      {SHORTCUTS.map(([k, d]) => (
        <div key={k} className="flex items-center justify-between gap-3">
          <span className="opacity-80">{d}</span>
          <kbd>{k}</kbd>
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
    <div className="flex flex-col gap-1 px-3 pb-2">
      {need.map((a) => (
        <div key={a.id} className="flex items-center gap-3 rounded-lg bg-amber-500/15 px-4 py-2 text-[13px]">
          <Icon name="warning" size={16} className="text-amber-600" />
          <span className="flex-1">
            <b>{a.email}</b> 계정에 다시 로그인해야 합니다. 저장된 메일은 계속 볼 수 있습니다.
          </span>
          <button
            disabled={busy === a.id}
            className="rounded-full bg-amber-600 px-3 py-1 text-[12px] font-medium text-white disabled:opacity-50"
            onClick={() => {
              setBusy(a.id)
              api.accounts
                .reauth(a.id)
                .then(() => toast('success', '다시 로그인했습니다.'))
                .catch((e: Error) => toast('error', e.message === 'NO_OAUTH_CLIENT' ? 'OAuth 클라이언트를 먼저 등록하세요.' : e.message))
                .finally(() => setBusy(null))
            }}
          >
            {busy === a.id ? '브라우저에서 로그인...' : '다시 로그인'}
          </button>
        </div>
      ))}
    </div>
  )
}
