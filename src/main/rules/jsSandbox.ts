// Runs user JavaScript rules with node:vm. Pure Node (no Electron) so it can run inside a utilityProcess
// and in unit tests. The context has no require/process/fs; messages go in and results come out as JSON
// strings so no host-realm object is ever reachable from rule code.
import vm from 'node:vm'

export interface RuleOutcome {
  /** the rule's return value (JSON-decoded), null for no-op */
  result: unknown
  error: string | null
  logs: string[]
}

export interface BatchOutcome {
  /** syntax / top-level error: no message was run */
  fatal: string | null
  outcomes: RuleOutcome[]
}

/**
 * Accepted forms (see the editor template):
 *  - `function rule(msg) { ... }` (also `const rule = (msg) => ...`)
 *  - `export default (msg) => ...` / `export default function (msg) { ... }`
 *  - a bare function body using `msg` and `return`
 */
export function wrapJsRule(code: string): string {
  if (/^\s*export\s+default\b/m.test(code)) return code.replace(/^(\s*)export\s+default\b/m, '$1globalThis.__rule =')
  if (/\bfunction\s+rule\s*\(/.test(code) || /\b(const|let|var)\s+rule\s*=/.test(code))
    return `${code}\n;globalThis.__rule = rule;`
  // same line as the user's first line so error line numbers match the editor
  return `globalThis.__rule = function rule(msg) { ${code}\n};`
}

const PRELUDE = `
var __logs = [];
var __fmt = function (v) {
  if (typeof v === 'string') return v;
  try { return JSON.stringify(v); } catch (e) { return String(v); }
};
var console = {
  log: function () { __logs.push(Array.prototype.map.call(arguments, __fmt).join(' ')); },
};
console.info = console.warn = console.error = console.debug = console.log;
globalThis.__run = function (input) {
  __logs = [];
  try {
    if (typeof globalThis.__rule !== 'function') throw new Error('rule(msg) 함수를 찾을 수 없습니다.');
    var r = globalThis.__rule(JSON.parse(input));
    if (r && typeof r.then === 'function') throw new Error('rule은 Promise가 아닌 값을 반환해야 합니다 (async 미지원).');
    var out = JSON.stringify({ r: r === undefined ? null : r, logs: __logs });
    if (out === undefined) throw new Error('결과를 JSON으로 변환할 수 없습니다.');
    return out;
  } catch (e) {
    var msg = e && e.message ? (e.name ? e.name + ': ' : '') + e.message : String(e);
    var line = e && e.stack ? /rule\\.js:(\\d+)/.exec(e.stack) : null;
    return JSON.stringify({ e: msg + (line ? ' (' + line[1] + '행)' : ''), logs: __logs });
  }
};
`

const RUN = new vm.Script('__run(__input)', { filename: 'runner.js' })

function errorText(e: unknown): string {
  const err = e as { message?: string; name?: string; code?: string; stack?: string }
  if (err?.code === 'ERR_SCRIPT_EXECUTION_TIMEOUT') return '시간 초과: 규칙 실행이 너무 오래 걸립니다.'
  const line = err?.stack ? /rule\.js:(\d+)/.exec(err.stack) : null
  return `${err?.name ? `${err.name}: ` : ''}${err?.message ?? String(e)}${line ? ` (${line[1]}행)` : ''}`
}

/** Run one rule over many messages (JSON strings). `timeoutMs` applies to each message. */
export function runJsBatch(code: string, inputs: string[], timeoutMs = 200): BatchOutcome {
  const ctx = vm.createContext(Object.create(null), {
    name: 'mailbird-rule',
    codeGeneration: { strings: false, wasm: false }
  }) as Record<string, unknown>
  try {
    vm.runInContext(PRELUDE, ctx, { filename: 'prelude.js' })
    vm.runInContext(wrapJsRule(code), ctx, { filename: 'rule.js', timeout: timeoutMs * 5 })
  } catch (e) {
    return { fatal: errorText(e), outcomes: [] }
  }
  const outcomes: RuleOutcome[] = []
  for (const input of inputs) {
    ctx.__input = input
    try {
      const raw = RUN.runInContext(ctx, { timeout: timeoutMs }) as string
      const parsed = JSON.parse(raw) as { r?: unknown; e?: string; logs: string[] }
      outcomes.push({ result: parsed.e ? null : (parsed.r ?? null), error: parsed.e ?? null, logs: parsed.logs ?? [] })
    } catch (e) {
      outcomes.push({ result: null, error: errorText(e), logs: [] })
    }
  }
  return { fatal: null, outcomes }
}
