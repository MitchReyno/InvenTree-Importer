import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { strictJson } from '@invimport/contracts/json'
import {
  ResearchError,
  ResearchReapPendingError,
  assertResearchActive,
  refuseResearch,
} from './errors.ts'
import {
  MAX_RESEARCH_FRAME_BYTES,
  MAX_RESEARCH_OUTPUT_BYTES,
  MAX_RESEARCH_SESSION_MS,
} from './limits.ts'
import { MAX_RESEARCH_PROTOCOL_FRAMES, type ResearchProtocolSession } from './protocol.ts'

const TERMINATION_GRACE_MS = 250
const REAP_DEADLINE_MS = 1000

export interface ControlledResearchChild {
  qualification: 'fixture_only'
  script: URL
  args?: readonly string[]
  signal?: AbortSignal
  timeoutMs?: number
}

class FrameQueue implements AsyncIterable<unknown> {
  private readonly values: unknown[] = []
  private waiter?: {
    resolve: (value: IteratorResult<unknown>) => void
    reject: (error: unknown) => void
  }
  private ended = false
  private failure?: unknown

  push(value: unknown): void {
    if (this.ended) {
      return
    }
    const waiter = this.waiter
    this.waiter = undefined
    if (waiter) {
      waiter.resolve({ value, done: false })
    } else {
      this.values.push(value)
    }
  }

  finish(error?: unknown): void {
    if (this.ended) {
      return
    }
    this.ended = true
    this.failure = error
    if (error) {
      this.values.length = 0
    }
    const waiter = this.waiter
    this.waiter = undefined
    if (waiter) {
      if (error) {
        waiter.reject(error)
      } else {
        waiter.resolve({ value: undefined, done: true })
      }
    }
  }

  [Symbol.asyncIterator](): AsyncIterator<unknown> {
    return {
      next: () => {
        if (this.failure) {
          return Promise.reject(this.failure)
        }
        if (this.values.length > 0) {
          return Promise.resolve({ value: this.values.shift(), done: false })
        }
        if (this.ended) {
          return Promise.resolve({ value: undefined, done: true })
        }
        if (this.waiter) {
          return Promise.reject(new ResearchError('research_protocol_invalid'))
        }
        return new Promise((resolve, reject) => {
          this.waiter = { resolve, reject }
        })
      },
    }
  }
}

/** A trusted Node fixture only. This is not a sandbox for arbitrary scripts or native providers. */
export function controlledResearchSession(
  options: ControlledResearchChild,
): ResearchProtocolSession {
  if (options.qualification !== 'fixture_only' || options.script.protocol !== 'file:') {
    refuseResearch('research_native_unsupported')
  }
  const timeout = options.timeoutMs ?? MAX_RESEARCH_SESSION_MS
  if (!Number.isSafeInteger(timeout) || timeout < 1 || timeout > MAX_RESEARCH_SESSION_MS) {
    refuseResearch('research_request_invalid')
  }
  if (options.signal) {
    assertResearchActive(options.signal)
  }
  const child = spawn(process.execPath, [fileURLToPath(options.script), ...(options.args ?? [])], {
    env: { LANG: 'C.UTF-8' },
    stdio: ['pipe', 'pipe', 'pipe'],
    windowsHide: true,
    shell: false,
  })
  const frames = new FrameQueue()
  let buffered = Buffer.alloc(0)
  let outputBytes = 0
  let receivedFrames = 0
  let closing = false
  let closed = false
  let closePromise: Promise<void> | undefined

  let resolveReaped: () => void = () => {}

  const reaped = new Promise<void>((resolve) => {
    resolveReaped = resolve
  })

  function stopAfter(error: ResearchError) {
    frames.finish(error)
    void close().catch(() => {})
  }

  function received(chunk: Buffer, stdout: boolean) {
    outputBytes += chunk.length
    if (outputBytes > MAX_RESEARCH_OUTPUT_BYTES) {
      stopAfter(new ResearchError('research_capacity'))
      return
    }
    if (!stdout || closing) {
      return
    }
    buffered = Buffer.concat([buffered, chunk])
    let newline = buffered.indexOf(10)
    while (newline >= 0) {
      receivedFrames += 1
      if (receivedFrames > MAX_RESEARCH_PROTOCOL_FRAMES) {
        stopAfter(new ResearchError('research_capacity'))
        return
      }
      const bytes = buffered.subarray(0, newline)
      buffered = buffered.subarray(newline + 1)
      if (bytes.length === 0 || bytes.length > MAX_RESEARCH_FRAME_BYTES) {
        stopAfter(new ResearchError('research_capacity'))
        return
      }
      try {
        const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes)
        frames.push(strictJson(text))
      } catch {
        stopAfter(new ResearchError('research_protocol_invalid'))
        return
      }
      newline = buffered.indexOf(10)
    }
    if (buffered.length > MAX_RESEARCH_FRAME_BYTES) {
      stopAfter(new ResearchError('research_capacity'))
    }
  }

  child.stdout.on('data', (chunk: Buffer) => received(chunk, true))
  child.stderr.on('data', (chunk: Buffer) => received(chunk, false))
  child.stdin.on('error', () => stopAfter(new ResearchError('research_protocol_interrupted')))
  child.once('error', () => {
    if (child.pid === undefined) {
      closed = true
      resolveReaped()
    }
    stopAfter(new ResearchError('research_protocol_interrupted'))
  })
  child.once('close', () => {
    closed = true
    clearTimeout(lifetime)
    options.signal?.removeEventListener('abort', cancelled)
    if (!closing && buffered.length > 0) {
      frames.finish(new ResearchError('research_protocol_invalid'))
    } else {
      frames.finish()
    }
    resolveReaped()
  })

  function cancelled() {
    stopAfter(new ResearchError('research_cancelled'))
  }

  const lifetime = setTimeout(
    () => stopAfter(new ResearchError('research_protocol_interrupted')),
    timeout,
  )
  options.signal?.addEventListener('abort', cancelled, { once: true })
  if (options.signal?.aborted) {
    cancelled()
  }

  async function reap() {
    closing = true
    clearTimeout(lifetime)
    options.signal?.removeEventListener('abort', cancelled)
    frames.finish()
    if (closed) {
      return
    }
    child.stdin.end()
    child.kill('SIGTERM')
    const escalation = setTimeout(() => {
      if (!closed) {
        child.kill('SIGKILL')
      }
    }, TERMINATION_GRACE_MS)
    let deadline: ReturnType<typeof setTimeout> | undefined
    try {
      await Promise.race([
        reaped,
        new Promise<never>((_, reject) => {
          deadline = setTimeout(() => reject(new ResearchReapPendingError()), REAP_DEADLINE_MS)
        }),
      ])
    } finally {
      clearTimeout(escalation)
      clearTimeout(deadline)
    }
  }

  function close(): Promise<void> {
    closePromise ??= reap()
    return closePromise
  }

  async function send(frame: unknown): Promise<void> {
    if (closing || closed) {
      refuseResearch('research_protocol_interrupted')
    }
    let serialized: string
    try {
      serialized = JSON.stringify(frame)
    } catch {
      return refuseResearch('research_protocol_invalid')
    }
    if (
      typeof serialized !== 'string' ||
      Buffer.byteLength(serialized) > MAX_RESEARCH_FRAME_BYTES
    ) {
      refuseResearch('research_capacity')
    }
    await new Promise<void>((resolve, reject) => {
      child.stdin.write(`${serialized}\n`, (error) => {
        if (error) {
          reject(new ResearchError('research_protocol_interrupted'))
        } else {
          resolve()
        }
      })
    })
  }

  return Object.freeze({ send, messages: frames, close })
}
