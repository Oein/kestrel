// utilityProcess entry (built to out/main/ruleWorker.js): runs JS rule batches off the main process.
import { runJsBatch } from './jsSandbox'

interface Job {
  id: number
  code: string
  inputs: string[]
  timeoutMs: number
}

process.parentPort.on('message', (e) => {
  const job = e.data as Job
  let reply
  try {
    reply = { id: job.id, ...runJsBatch(job.code, job.inputs, job.timeoutMs) }
  } catch (err) {
    reply = { id: job.id, fatal: (err as Error).message, outcomes: [] }
  }
  process.parentPort.postMessage(reply)
})
