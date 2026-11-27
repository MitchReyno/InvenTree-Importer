import { NativeSessionError } from './failure-model.ts'
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { setTimeout as delay } from 'node:timers/promises'
import { strictJson } from '@invimport/contracts/json'
import { ResearchReapPendingError } from '#/research/errors.ts'

/** Per-line and per-turn ceilings on what a provider CLI may print. */
export interface ChildLimits {
  frameBytes: number
  outputBytes: number
  /** Parsed frames not yet read, so a stalled reader can't grow memory up to `outputBytes`. */
  queuedBytes: number
}

/** A session without tools prints short JSON lines. */
export const DEFAULT_LIMITS: ChildLimits = {
  frameBytes: 256 * 1024,
  outputBytes: 2 * 1024 * 1024,
  queuedBytes: 2 * 1024 * 1024,
}

/**
 * Claude Code in a VM tool session echoes every tool result, so one line can carry a delivered
 * image (at most 1.25 MiB, about 1.7 MB as base64) and a long session prints far more than 2 MiB
 * in all. The Claude adapter reads frames as they arrive and keeps none, so the per-turn figure
 * is a runaway guard, not a working limit. Codex reports image views by path and keeps the
 * default limits, since its adapter holds every notification until the turn ends.
 */
export const TOOL_SESSION_LIMITS: ChildLimits = {
  // One image echo is about 1.7 MB; parsing a line costs many times its size in memory.
  frameBytes: 4 * 1024 * 1024,
  outputBytes: 512 * 1024 * 1024,
  // A parsed frame takes many times its wire size in memory; this keeps a worker that waits
  // before reading well inside its 640 MiB container.
  queuedBytes: 8 * 1024 * 1024,
}
const MAX_STDERR_BYTES = 128 * 1024
const REAP_DEADLINE_MS = 2000

/** Bounded JSON-lines transport. Raw stdout/stderr never reaches application logs or public errors. */
export class AgentChild {
  private readonly child: ChildProcessWithoutNullStreams
  private readonly frames: unknown[] = []
  private readonly frameSizes: number[] = []
  private queuedBytes = 0
  private wake: (() => void) | undefined
  private failure: Error | undefined
  private ended = false
  private escalation: ReturnType<typeof setTimeout> | undefined
  private buffer = Buffer.alloc(0)
  private outputBytes = 0
  private errorBytes = 0
  private readonly exit: Promise<void>

  constructor(
    executable: string,
    args: string[],
    cwd: string,
    env: NodeJS.ProcessEnv,
    signal: AbortSignal,
    private readonly framing: 'lines' | 'json' = 'lines',
    private readonly limits: ChildLimits = DEFAULT_LIMITS,
  ) {
    signal.throwIfAborted()
    this.child = spawn(executable, args, { cwd, env, shell: false, detached: true, stdio: 'pipe' })

    const abort = () => this.reject('agent_cancelled')

    signal.addEventListener('abort', abort, { once: true })
    this.exit = new Promise((resolve) => {
      this.child.once('close', (code) => {
        signal.removeEventListener('abort', abort)
        if (this.framing === 'json' && this.buffer.length && !this.failure) {
          try {
            this.frames.push(
              strictJson(
                new TextDecoder('utf-8', { fatal: true }).decode(this.buffer),
                this.limits.frameBytes,
              ),
            )
            this.buffer = Buffer.alloc(0)
          } catch {
            this.failure = new NativeSessionError('agent_protocol_invalid')
          }
        }
        this.ended = true
        if (code !== 0 && !this.failure) {
          this.failure = new NativeSessionError('agent_process_failed')
        }
        this.wake?.()
        resolve()
      })
    })
    this.child.once('error', () => this.reject('agent_process_unavailable'))
    this.child.stdin.on('error', () => this.reject('agent_input_closed'))
    this.child.stdout.on('data', (bytes: Buffer) => this.receive(bytes))
    this.child.stderr.on('data', (bytes: Buffer) => {
      this.errorBytes += bytes.length
      if (this.errorBytes > MAX_STDERR_BYTES) {
        this.reject('agent_output_capacity')
      }
    })
  }

  private reject(code: string) {
    this.failure ??= new NativeSessionError(code)
    // Nothing more is read after a failure, so release what is held now.
    this.buffer = Buffer.alloc(0)
    this.frames.length = 0
    this.frameSizes.length = 0
    this.queuedBytes = 0
    this.stop()
    // Escalation must not depend on the caller leaving a backpressured stdin write.
    this.escalation ??= setTimeout(() => {
      if (this.child.pid && this.groupAlive()) {
        try {
          process.kill(-this.child.pid, 'SIGKILL')
        } catch {
          /* Reap checks absence. */
        }
      }
    }, 250)
    this.wake?.()
  }

  private receive(bytes: Buffer) {
    // A failed child is being stopped; whatever it still prints is discarded.
    if (this.failure) {
      return
    }
    this.outputBytes += bytes.length
    if (this.outputBytes > this.limits.outputBytes) {
      this.reject('agent_output_capacity')
      return
    }
    this.buffer = Buffer.concat([this.buffer, bytes])
    if (this.framing === 'json') {
      return
    }
    let newline: number
    while ((newline = this.buffer.indexOf(10)) !== -1) {
      const frame = this.buffer.subarray(0, newline)
      this.buffer = this.buffer.subarray(newline + 1)
      if (frame.length > this.limits.frameBytes) {
        this.reject('agent_frame_capacity')
        return
      }
      if (!frame.length) {
        continue
      }
      try {
        const text = new TextDecoder('utf-8', { fatal: true }).decode(frame)
        if (this.queuedBytes + frame.length > this.limits.queuedBytes) {
          this.reject('agent_output_capacity')
          return
        }
        this.frames.push(strictJson(text, this.limits.frameBytes))
        this.frameSizes.push(frame.length)
        this.queuedBytes += frame.length
      } catch {
        this.reject('agent_protocol_invalid')
        return
      }
    }
    if (this.buffer.length > this.limits.frameBytes) {
      this.reject('agent_frame_capacity')
    }
    this.wake?.()
  }

  async send(frame: unknown) {
    if (this.ended || this.failure) {
      throw new NativeSessionError('agent_input_closed')
    }
    await new Promise<void>((resolve, reject) => {
      this.child.stdin.write(JSON.stringify(frame) + '\n', (error) =>
        error ? reject(new NativeSessionError('agent_input_closed')) : resolve(),
      )
    })
  }

  endInput() {
    this.child.stdin.end()
  }

  async next(): Promise<unknown | undefined> {
    while (true) {
      if (this.failure) {
        throw this.failure
      }
      if (this.frames.length) {
        this.queuedBytes -= this.frameSizes.shift() ?? 0
        return this.frames.shift()
      }
      if (this.ended) {
        if (this.buffer.length) {
          throw new NativeSessionError('agent_truncated_frame')
        }
        return undefined
      }
      await new Promise<void>((resolve) => {
        this.wake = resolve
      })
      this.wake = undefined
    }
  }

  private groupAlive() {
    if (!this.child.pid) {
      return false
    }
    try {
      process.kill(-this.child.pid, 0)
      return true
    } catch (error) {
      if (error && typeof error === 'object' && 'code' in error && error.code === 'ESRCH') {
        return false
      }
      return true
    }
  }

  private stop() {
    if (this.child.pid) {
      try {
        process.kill(-this.child.pid, 'SIGTERM')
      } catch {
        /* Reap still checks group absence. */
      }
    }
  }

  async close() {
    this.stop()
    const deadline = Date.now() + REAP_DEADLINE_MS
    const forceAt = Date.now() + 250
    while (!this.ended || this.groupAlive()) {
      if (Date.now() >= forceAt && this.child.pid) {
        try {
          process.kill(-this.child.pid, 'SIGKILL')
        } catch {
          /* Absence is checked below. */
        }
      }
      if (Date.now() >= deadline) {
        throw new ResearchReapPendingError()
      }
      await delay(20)
    }
    clearTimeout(this.escalation)
    await this.exit
  }
}

export function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new NativeSessionError('agent_protocol_invalid')
  }
  return value as Record<string, unknown>
}
