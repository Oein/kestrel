// "일반" settings tab body: notifications, launch at login, menu bar.
import { useEffect, useState } from 'react'
import type { AppSettings } from '../../../shared/types'
import { api, toast } from '../store'
import { Icon } from './Icon'
import { btn, Checkbox } from './ui'

function Row(props: { label: string; desc?: React.ReactNode; children: React.ReactNode }): React.JSX.Element {
  return (
    <div className="flex min-h-[52px] items-center gap-4 px-4 py-2.5">
      <div className="min-w-0 flex-1">
        <div className="text-[13px] font-medium text-ink">{props.label}</div>
        {props.desc && <div className="mt-0.5 text-[12px] text-ink-3">{props.desc}</div>}
      </div>
      {props.children}
    </div>
  )
}

export function GeneralSettings(): React.JSX.Element {
  const [s, setS] = useState<AppSettings | null>(null)
  const [testing, setTesting] = useState(false)

  useEffect(() => {
    void api.settings.get().then(setS)
    return api.on('settings:changed', setS)
  }, [])

  const update = (patch: Partial<AppSettings>): void => {
    if (!s) return
    setS({ ...s, ...patch }) // optimistic
    api.settings.set(patch).then(setS, (e: Error) => {
      toast('error', e.message)
      void api.settings.get().then(setS)
    })
  }

  const test = (): void => {
    setTesting(true)
    api.app
      .testNotification()
      .catch((e: Error) => toast('error', e.message))
      .finally(() => setTesting(false))
  }

  if (!s) return <div className="py-10 text-center text-[12.5px] text-ink-3">불러오는 중…</div>

  return (
    <>
      <section className="mb-6">
        <h3 className="mb-2 text-[11.5px] font-semibold tracking-wide text-ink-3">알림</h3>
        <div className="divide-y divide-line rounded-xl border border-line bg-surface">
          <Row label="새 메일 알림" desc="받은편지함에 읽지 않은 새 메일이 오면 알려 줍니다. 창을 보고 있을 때는 알리지 않습니다.">
            <Checkbox checked={s.notifications} onChange={() => update({ notifications: !s.notifications })} title="새 메일 알림" />
          </Row>
          <Row label="테스트 알림" desc="알림이 오지 않으면 시스템 설정 → 알림에서 Mailbird가 허용되어 있는지 확인하세요.">
            <button className={btn.secondary} onClick={test} disabled={testing}>
              <Icon name="bell" size={14} />
              테스트 알림 보내기
            </button>
          </Row>
        </div>
      </section>

      <section className="mb-6">
        <h3 className="mb-2 text-[11.5px] font-semibold tracking-wide text-ink-3">실행</h3>
        <div className="divide-y divide-line rounded-xl border border-line bg-surface">
          <Row label="로그인 시 자동 실행" desc="Mac에 로그인하면 메뉴바에서 조용히 시작해 메일을 동기화합니다.">
            <Checkbox checked={s.launchAtLogin} onChange={() => update({ launchAtLogin: !s.launchAtLogin })} title="로그인 시 자동 실행" />
          </Row>
          <Row
            label="창을 닫으면 메뉴바에 남기기"
            desc={s.keepInMenuBar ? '창을 닫아도 메뉴바 아이콘으로 남아 백그라운드에서 동기화하고 알림을 보냅니다.' : '창을 닫으면 앱이 종료됩니다.'}
          >
            <Checkbox checked={s.keepInMenuBar} onChange={() => update({ keepInMenuBar: !s.keepInMenuBar })} title="창을 닫으면 메뉴바에 남기기" />
          </Row>
        </div>
      </section>
    </>
  )
}
