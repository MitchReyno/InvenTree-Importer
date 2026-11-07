import { NativeSessionError } from './failure-model.ts'
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { setTimeout as delay } from 'node:timers/promises'
import { strictJson } from '@invimport/contracts/json'
import { ResearchReapPendingError } from '../research/errors.ts'

const MAX_FRAME_BYTES = 256 * 1024
const MAX_OUTPUT_BYTES = 2 * 1024 * 1024
const MAX_STDERR_BYTES = 128 * 1024
const REAP_DEADLINE_MS = 2000

/** Bounded JSON-lines transport. Raw stdout/stderr never reaches application logs or public errors. */
export class AgentChild {
  private readonly child: ChildProcessWithoutNullStreams
  private readonly frames: unknown[] = []
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
              strictJson(new TextDecoder('utf-8', { fatal: true }).decode(this.buffer)),
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
    this.outputBytes += bytes.length
    if (this.outputBytes > MAX_OUTPUT_BYTES) {
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
      if (frame.length > MAX_FRAME_BYTES) {
        this.reject('agent_frame_capacity')
        return
      }
      if (!frame.length) {
        continue
      }
      try {
        const text = new TextDecoder('utf-8', { fatal: true }).decode(frame)
        this.frames.push(strictJson(text))
      } catch {
        this.reject('agent_protocol_invalid')
        return
      }
    }
    if (this.buffer.length > MAX_FRAME_BYTES) {
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
