// Main-process side of the JS rule sandbox: a lazily started Electron utilityProcess running node:vm.
import { utilityProcess, type UtilityProcess } from 'electron'
import { join } from 'path'
import type { BatchOutcome } from './jsSandbox'

interface Pending {
  resolve: (o: BatchOutcome) => void
  timer: NodeJS.Timeout
}

const IDLE_MS = 60_000

export class JsRunner {
  private proc: UtilityProcess | null = null
  private pending = new Map<number, Pending>()
  private seq = 0
  private idleTimer: NodeJS.Timeout | null = null

  private ensure(): UtilityProcess {
    if (this.proc) return this.proc
    const p = utilityProcess.fork(join(__dirname, 'ruleWorker.js'), [], { serviceName: 'Kestrel Rules' })
    p.on('message', (m: BatchOutcome & { id: number }) => {
      const job = this.pending.get(m.id)
      if (!job) return
      clearTimeout(job.timer)
      this.pending.delete(m.id)
      job.resolve({ fatal: m.fatal, outcomes: m.outcomes })
      this.scheduleIdle()
    })
    p.on('exit', () => {
      if (this.proc === p) this.proc = null
      this.failAll('규칙 실행 프로세스가 종료되었습니다.')
    })
    this.proc = p
    return p
  }

  private failAll(reason: string): void {
    for (const [id, job] of this.pending) {
      clearTimeout(job.timer)
      job.resolve({ fatal: reason, outcomes: [] })
      this.pending.delete(id)
    }
  }

  private scheduleIdle(): void {
    if (this.idleTimer) clearTimeout(this.idleTimer)
    this.idleTimer = setTimeout(() => {
      if (!this.pending.size) this.dispose()
    }, IDLE_MS)
  }

  run(code: string, inputs: string[], timeoutMs = 200): Promise<BatchOutcome> {
    const proc = this.ensure()
    const id = ++this.seq
    return new Promise((resolve) => {
      // vm enforces the per-message timeout; this guards against a wedged process
      const timer = setTimeout(() => {
        this.pending.delete(id)
        resolve({ fatal: '시간 초과: 규칙 실행이 너무 오래 걸립니다.', outcomes: [] })
        this.proc?.kill()
      }, 2000 + inputs.length * (timeoutMs + 20))
      this.pending.set(id, { resolve, timer })
      proc.postMessage({ id, code, inputs, timeoutMs })
    })
  }

  dispose(): void {
    if (this.idleTimer) clearTimeout(this.idleTimer)
    this.proc?.kill()
    this.proc = null
  }
}
