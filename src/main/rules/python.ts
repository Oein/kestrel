// Python rules: one `python3` process per batch running a small runner script that imports the user's
// `def rule(msg)` and maps JSON lines (stdin) to JSON lines (stdout), with a per-message timeout.
// No Electron imports so it can be unit-tested.
import { spawn } from 'child_process'
import { existsSync } from 'fs'
import { mkdir, readFile, writeFile } from 'fs/promises'
import { delimiter, join } from 'path'
import { randomUUID } from 'crypto'
import { unlink } from 'fs/promises'
import type { BatchOutcome, RuleOutcome } from './jsSandbox'

export const PYTHON_RUNNER = `# Kestrel rule runner (generated; overwritten on every run)
import contextlib, io, json, signal, sys, traceback


def fmt(e):
    line = None
    for fr in traceback.extract_tb(e.__traceback__):
        if fr.filename == 'rule.py':
            line = fr.lineno
    if isinstance(e, SyntaxError) and e.filename == 'rule.py':
        line = e.lineno
    text = '%s: %s' % (type(e).__name__, e)
    return text + (' (%d행)' % line if line else '')


class RuleTimeout(Exception):
    pass


def on_alarm(signum, frame):
    raise RuleTimeout('시간 초과: 규칙 실행이 너무 오래 걸립니다.')


def main():
    out = sys.stdout
    path, timeout = sys.argv[1], float(sys.argv[2])
    ns = {'__name__': 'kestrel_rule'}
    try:
        with open(path, encoding='utf-8') as f:
            src = f.read()
        code = compile(src, 'rule.py', 'exec')
        with contextlib.redirect_stdout(io.StringIO()):
            exec(code, ns)
        rule = ns.get('rule')
        if not callable(rule):
            raise NameError('rule(msg) 함수를 정의하세요: def rule(msg): ...')
    except BaseException as e:
        out.write(json.dumps({'fatal': fmt(e)}, ensure_ascii=False) + '\\n')
        out.flush()
        return
    signal.signal(signal.SIGALRM, on_alarm)
    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue
        buf = io.StringIO()
        try:
            msg = json.loads(line)
            signal.setitimer(signal.ITIMER_REAL, timeout)
            try:
                with contextlib.redirect_stdout(buf):
                    r = rule(msg)
            finally:
                signal.setitimer(signal.ITIMER_REAL, 0)
            s = json.dumps({'result': r, 'logs': buf.getvalue().splitlines()}, ensure_ascii=False)
        except BaseException as e:
            s = json.dumps({'error': fmt(e), 'logs': buf.getvalue().splitlines()}, ensure_ascii=False)
        out.write(s + '\\n')
        out.flush()


main()
`

export const PYTHON_MISSING = 'python3를 찾을 수 없습니다. Python 3를 설치하세요 (예: brew install python).'

/** GUI apps get a minimal PATH on macOS, so look in the usual install locations first. */
export function findPython(): string | null {
  const env = process.env.KESTREL_PYTHON
  if (env && existsSync(env)) return env
  const candidates = ['/opt/homebrew/bin/python3', '/usr/local/bin/python3']
  for (const dir of (process.env.PATH ?? '').split(delimiter)) if (dir) candidates.push(join(dir, 'python3'))
  candidates.push('/usr/bin/python3')
  return candidates.find((p) => existsSync(p)) ?? null
}

export class PythonRunner {
  private runnerPath: string
  private python: string | null | undefined

  constructor(private dir: string) {
    this.runnerPath = join(dir, 'rule_runner.py')
  }

  private async prepare(): Promise<void> {
    await mkdir(this.dir, { recursive: true })
    const cur = await readFile(this.runnerPath, 'utf8').catch(() => '')
    if (cur !== PYTHON_RUNNER) await writeFile(this.runnerPath, PYTHON_RUNNER)
  }

  async run(code: string, inputs: string[], timeoutMs = 200): Promise<BatchOutcome> {
    if (this.python === undefined) this.python = findPython()
    if (!this.python) return { fatal: PYTHON_MISSING, outcomes: [] }
    await this.prepare()
    const codePath = join(this.dir, `rule-${randomUUID()}.py`)
    await writeFile(codePath, code)
    try {
      return await this.exec(this.python, codePath, inputs, timeoutMs)
    } finally {
      void unlink(codePath).catch(() => {})
    }
  }

  private exec(python: string, codePath: string, inputs: string[], timeoutMs: number): Promise<BatchOutcome> {
    return new Promise((resolve) => {
      const child = spawn(python, ['-B', this.runnerPath, codePath, String(timeoutMs / 1000)], {
        stdio: ['pipe', 'pipe', 'pipe'],
        env: { ...process.env, PYTHONIOENCODING: 'utf-8', PYTHONDONTWRITEBYTECODE: '1' }
      })
      let stdout = ''
      let stderr = ''
      let done = false
      const finish = (out: BatchOutcome): void => {
        if (done) return
        done = true
        clearTimeout(guard)
        resolve(out)
      }
      // whole-batch guard: startup + per-message budget
      const guard = setTimeout(() => {
        child.kill('SIGKILL')
        finish({ fatal: '시간 초과: Python 규칙 실행이 너무 오래 걸립니다.', outcomes: [] })
      }, 3000 + inputs.length * (timeoutMs + 50))
      child.stdout.setEncoding('utf8').on('data', (d: string) => (stdout += d))
      child.stderr.setEncoding('utf8').on('data', (d: string) => (stderr += d.slice(0, 4000)))
      child.on('error', (e: NodeJS.ErrnoException) => {
        if (e.code === 'ENOENT') this.python = undefined
        finish({ fatal: e.code === 'ENOENT' ? PYTHON_MISSING : `Python 실행 실패: ${e.message}`, outcomes: [] })
      })
      child.on('close', (codeNum) => {
        const lines = stdout.split('\n').filter(Boolean)
        const parsed: Record<string, unknown>[] = []
        for (const l of lines) {
          try {
            parsed.push(JSON.parse(l) as Record<string, unknown>)
          } catch {
            /* stray output */
          }
        }
        const fatal = parsed.find((p) => 'fatal' in p)
        if (fatal) return finish({ fatal: String(fatal.fatal), outcomes: [] })
        if (parsed.length < inputs.length) {
          const tail = stderr.trim().split('\n').slice(-2).join(' ')
          return finish({ fatal: `Python 규칙이 비정상 종료되었습니다 (code ${codeNum})${tail ? `: ${tail}` : ''}`, outcomes: [] })
        }
        const outcomes: RuleOutcome[] = parsed.slice(0, inputs.length).map((p) => ({
          result: 'error' in p ? null : (p.result ?? null),
          error: 'error' in p ? String(p.error) : null,
          logs: Array.isArray(p.logs) ? (p.logs as string[]) : []
        }))
        finish({ fatal: null, outcomes })
      })
      child.stdin.on('error', () => {}) // EPIPE when the script dies early
      child.stdin.end(inputs.map((i) => i.replace(/\n/g, ' ')).join('\n') + '\n')
    })
  }
}
