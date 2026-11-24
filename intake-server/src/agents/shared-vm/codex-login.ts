import { mkdir, mkdtemp, readdir, rename, rm, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { AgentChild, record } from '#/agents/child.ts'
import { CODEX_CONFIG } from '#/agents/codex.ts'
import { requireCodexSessionVersion } from '#/agents/session/session-admission.ts'
import { ResearchReapPendingError } from '#/research/errors.ts'

type Device = { loginId: string; verificationUrl: string; userCode: string }
type Login = { rpc: AccountRpc; device: Device; home: string; expires: number }

const unavailable = () => new Error('codex_account_unavailable')

type AccountRpc = Pick<LoginRpc, 'request' | 'initialize' | 'connected' | 'close' | 'completion'>
class LoginRpc {
  private sequence = 0
  completion?: Record<string, unknown>
  private readonly abort = new AbortController()
  private readonly child: AgentChild

  constructor(root: string, home: string, exclusive: boolean) {
    const args = [
      '-n',
      '-F',
      exclusive ? '-x' : '-s',
      join(root, 'use.lock'),
      'codex',
      'app-server',
      '--listen',
      'stdio://',
      '-c',
      'forced_login_method="chatgpt"',
      '-c',
      'cli_auth_credentials_store="file"',
    ]
    for (const [name, value] of Object.entries(CODEX_CONFIG)) {
      args.push('-c', name + '=' + JSON.stringify(value))
    }
    this.child = new AgentChild(
      'flock',
      args,
      '/tmp',
      {
        HOME: '/tmp',
        PATH: process.env.PATH,
        CODEX_HOME: home,
        HTTPS_PROXY: 'http://127.0.0.1:14316',
        NO_PROXY: '127.0.0.1,localhost',
      },
      this.abort.signal,
    )
  }

  async initialize() {
    const result = await this.request('initialize', {
      clientInfo: { name: 'bench_intake', version: '1' },
      capabilities: { experimentalApi: true },
    })
    requireCodexSessionVersion(result.userAgent)
    await this.child.send({ method: 'initialized' })
  }

  async request(method: string, params: unknown) {
    const id = ++this.sequence
    const timer = setTimeout(() => this.abort.abort(), 20000)
    try {
      await this.child.send({ id, method, params })
      for (;;) {
        const msg = record(await this.child.next())
        if (msg.method === 'account/login/completed') {
          this.completion = record(msg.params)
        }
        if (msg.id === id) {
          if (msg.error) {
            throw unavailable()
          }
          return record(msg.result ?? {})
        }
      }
    } finally {
      clearTimeout(timer)
    }
  }

  async connected() {
    const account = (await this.request('account/read', { refreshToken: false })).account
    return account != null && record(account).type === 'chatgpt'
  }

  close() {
    return this.child.close()
  }
}

async function exists(path: string) {
  return stat(path).then(
    () => true,
    (e) => {
      if (e.code === 'ENOENT') {
        return false
      }
      throw e
    },
  )
}

export function parseDevice(v: Record<string, unknown>): Device {
  if (
    v.type !== 'chatgptDeviceCode' ||
    v.verificationUrl !== 'https://auth.openai.com/codex/device' ||
    typeof v.loginId !== 'string' ||
    !/^[a-fA-F0-9-]{36}$/.test(v.loginId) ||
    typeof v.userCode !== 'string' ||
    !/^[A-Z0-9-]{6,20}$/.test(v.userCode)
  ) {
    throw unavailable()
  }
  return { loginId: v.loginId, verificationUrl: v.verificationUrl, userCode: v.userCode }
}

/**
 * What the read-only status sees. A known state carries its age in milliseconds and whether a
 * check is running now. `checking` means no check has finished since this process started or
 * since the last sign-in change; `timeout` and `unavailable` mean the latest check failed with no
 * earlier result to report; `busy` means a sign-in change is running.
 */
export type CodexStatusRead =
  | { state: 'signed_in' | 'signed_out' | 'signing_in'; ageMs: number; refreshing: boolean }
  | { state: 'checking' | 'busy' | 'timeout' | 'unavailable' }

/** When a Codex status check is redone, how long one may run, and the clock that times them. */
export interface CodexStatusOptions {
  /** A result younger than this is reported without a new check. */
  freshMs: number
  /** A check is stopped, its account process killed and reaped, after this long. */
  refreshTimeoutMs: number
  /**
   * Every check but the first after a sign-in change starts at least this long after the
   * previous one started, so Check again and a failing check can't run back to back.
   */
  minRefreshIntervalMs: number
  /** Monotonic milliseconds, so a guest clock step never resets freshness or the interval. */
  now: () => number
}

/**
 * `account/read` took 1.5-1.9 s on an idle 2-CPU VM, longer than a status request may wait, so
 * reads answer from the last check. Sign-in changes made here forget it at once, so the window
 * only bounds how late a change made elsewhere (such as a revoked token) is seen.
 */
const CODEX_STATUS_OPTIONS: CodexStatusOptions = {
  freshMs: 60_000,
  refreshTimeoutMs: 10_000,
  minRefreshIntervalMs: 5_000,
  now: () => performance.now(),
}

type CheckedState = { state: 'signed_in' | 'signed_out'; at: number }

class CheckTimedOut extends Error {}

/** One status check in progress; at most one runs at a time. */
interface StatusCheck {
  stop: AbortController
  done: Promise<void>
}

export class CodexAccount {
  private lastStatusLogin?: string
  private pending?: Login
  private timer?: ReturnType<typeof setTimeout>
  private busy = false
  private readonly status: CodexStatusOptions
  /** The last completed check, and the failure of a later one when there is no result. */
  private lastCheck?: CheckedState
  private lastFailure?: 'timeout' | 'unavailable'
  private lastCheckStartedAt?: number
  private check?: StatusCheck
  /** A check whose process wasn't confirmed gone; no further check starts beside it. */
  private reapUnconfirmed = false
  /** Bumped by each sign-in change, so a check that started before it is never reported. */
  private generation = 0

  constructor(
    private readonly root: string,
    private readonly rpc: (root: string, home: string, exclusive: boolean) => AccountRpc = (
      root,
      home,
      exclusive,
    ) => new LoginRpc(root, home, exclusive),
    status: Partial<CodexStatusOptions> = {},
  ) {
    this.status = { ...CODEX_STATUS_OPTIONS, ...status }
  }

  private async abandon() {
    const login = this.pending
    this.pending = undefined
    clearTimeout(this.timer)
    if (login) {
      await login.rpc.close()
      await rm(login.home, { recursive: true, force: true })
    }
  }

  async action(action: unknown, loginId?: unknown) {
    if (this.busy) {
      throw unavailable()
    }
    this.busy = true
    // Only a plain status read without a pending login leaves the sign-in as it was.
    const changesSignIn = action !== 'status' || this.pending !== undefined
    try {
      if (changesSignIn) {
        // A check holds the account lock and may run for seconds, so it is stopped rather than
        // waited for; only its process's reap is awaited. If that reap isn't confirmed, the
        // process may still hold the lock, and the exclusive `flock -n` of a sign-in refuses.
        await this.stopCheck()
      }
      return await this.perform(action, loginId)
    } finally {
      if (changesSignIn) {
        this.forgetChecks()
      }
      this.busy = false
    }
  }

  /**
   * Reads the sign-in state at once, without changing it. A pending login is reported from
   * memory, even once expired, and a missing account directory as signed out. Otherwise the
   * answer is the last check's, and a check starts in the background when there is none, it is
   * stale, or `refresh` asks for one, unless the request has already ended (`signal`); it runs
   * `account/read` without a refresh under the shared lock turns take.
   */
  async readStatus(refresh = false, signal?: AbortSignal): Promise<CodexStatusRead> {
    for (;;) {
      const fromMemory = this.statusFromMemory()
      if (fromMemory) {
        return fromMemory
      }
      const generation = this.generation
      const present = await exists(join(this.root, 'account'))
      // A sign-in change may have started or finished while the directory was read.
      const changedMeanwhile = generation !== this.generation || this.busy || this.pending
      if (changedMeanwhile) {
        continue
      }
      if (!present) {
        return { state: 'signed_out', ageMs: 0, refreshing: false }
      }
      if (!signal?.aborted && this.checkDue(refresh)) {
        this.startCheck()
      }
      return this.lastResult()
    }
  }

  private statusFromMemory(): CodexStatusRead | undefined {
    if (this.busy) {
      return { state: 'busy' }
    }
    if (this.pending) {
      return { state: 'signing_in', ageMs: 0, refreshing: false }
    }
    return undefined
  }

  private lastResult(): CodexStatusRead {
    if (this.lastCheck) {
      return {
        state: this.lastCheck.state,
        ageMs: Math.max(0, this.status.now() - this.lastCheck.at),
        refreshing: this.check !== undefined,
      }
    }
    if (this.lastFailure) {
      return { state: this.lastFailure }
    }
    // No check will start beside a process that may still be running.
    return { state: this.reapUnconfirmed ? 'unavailable' : 'checking' }
  }

  private checkDue(refresh: boolean) {
    if (this.check || this.reapUnconfirmed) {
      return false
    }
    const now = this.status.now()
    const sinceLastStart =
      this.lastCheckStartedAt === undefined ? Infinity : now - this.lastCheckStartedAt
    const intervalPassed = sinceLastStart >= this.status.minRefreshIntervalMs
    if (!this.lastCheck) {
      // A first check starts at once; after it fails, it is retried at the interval.
      return this.lastFailure === undefined || intervalPassed
    }
    const stale = now - this.lastCheck.at >= this.status.freshMs
    return intervalPassed && (stale || refresh)
  }

  private startCheck() {
    const generation = this.generation
    const stop = new AbortController()
    const timer = setTimeout(() => stop.abort(new CheckTimedOut()), this.status.refreshTimeoutMs)
    this.lastCheckStartedAt = this.status.now()
    const done = this.readAccount(stop.signal).then(
      (state) => {
        if (generation === this.generation) {
          this.lastCheck = { state, at: this.status.now() }
          this.lastFailure = undefined
        }
      },
      (error: unknown) => {
        if (error instanceof ResearchReapPendingError) {
          this.reapUnconfirmed = true
        }
        // A failed check keeps an earlier result, which still says how old it is.
        if (generation === this.generation) {
          this.lastFailure = stop.signal.reason instanceof CheckTimedOut ? 'timeout' : 'unavailable'
        }
      },
    )
    const check: StatusCheck = { stop, done }
    this.check = check
    void done.finally(() => {
      clearTimeout(timer)
      if (this.check === check) {
        this.check = undefined
      }
    })
  }

  /** Stops a running check and waits for its account process to be reaped. */
  private async stopCheck() {
    const check = this.check
    if (check) {
      check.stop.abort()
      await check.done
    }
  }

  /** A sign-in change waives the interval too, so the first read after it checks at once. */
  private forgetChecks() {
    this.generation++
    this.lastCheck = undefined
    this.lastFailure = undefined
    this.lastCheckStartedAt = undefined
  }

  private async readAccount(signal: AbortSignal): Promise<'signed_in' | 'signed_out'> {
    // Settles as soon as the check is stopped.
    const abandoned = new Promise<never>((_resolve, reject) => {
      if (signal.aborted) {
        reject(signal.reason)
      }
      signal.addEventListener('abort', () => reject(signal.reason), { once: true })
    })
    abandoned.catch(() => {})
    const rpc = this.rpc(this.root, join(this.root, 'account'), false)
    try {
      await Promise.race([rpc.initialize(), abandoned])
      const connected = await Promise.race([rpc.connected(), abandoned])
      return connected ? 'signed_in' : 'signed_out'
    } finally {
      // Returns only once the account process is reaped; throws when that isn't confirmed.
      await rpc.close()
    }
  }

  private async perform(action: unknown, loginId: unknown) {
    const active = join(this.root, 'account')
    if (this.pending) {
      const login = this.pending
      if (loginId !== undefined && loginId !== login.device.loginId) {
        throw unavailable()
      }
      if (action === 'cancel' && loginId !== login.device.loginId) {
        throw unavailable()
      }
      const expired = Date.now() >= login.expires
      if (action === 'cancel' || expired) {
        try {
          await login.rpc.request('account/login/cancel', { loginId: login.device.loginId })
        } finally {
          if (expired) {
            this.lastStatusLogin = login.device.loginId
          }
          await this.abandon()
        }
        return { state: 'disconnected' }
      }
      if (action !== 'status') {
        throw unavailable()
      }
      try {
        const connected = await login.rpc.connected()
        const completion = login.rpc.completion
        if (!completion || completion.loginId !== login.device.loginId) {
          return { state: 'pending', ...login.device }
        }
        if (completion.success !== true) {
          await this.abandon()
          return { state: 'denied' }
        }
        if (!connected) {
          throw unavailable()
        }
        // Promote only the matching completed attempt, while its exclusive lock is held.
        await rename(login.home, active)
        this.lastStatusLogin = login.device.loginId
        await this.abandon()
        return { state: 'connected' }
      } catch (error) {
        await this.abandon()
        throw error
      }
    }
    if (
      !['status', 'start', 'disconnect'].includes(String(action)) ||
      (loginId !== undefined && !(action === 'status' && loginId === this.lastStatusLogin))
    ) {
      throw unavailable()
    }
    if (await exists(active)) {
      const rpc = this.rpc(this.root, active, action !== 'status')
      try {
        await rpc.initialize()
        if (action === 'disconnect') {
          this.lastStatusLogin = undefined
          await rpc.request('account/logout', {})
          if (await rpc.connected()) {
            throw unavailable()
          }
        }
        const connected = await rpc.connected()
        if (connected || action === 'status') {
          return { state: connected ? 'connected' : 'disconnected' }
        }
        await rename(active, join(this.root, 'signed-out-' + randomUUID()))
      } finally {
        await rpc.close()
      }
    }
    if (action !== 'start') {
      return { state: 'disconnected' }
    }
    await mkdir(this.root, { recursive: true, mode: 0o700 })
    this.lastStatusLogin = undefined
    const home = await mkdtemp(join(this.root, 'login-'))
    const rpc = this.rpc(this.root, home, true)
    try {
      await rpc.initialize()
      // A replaced management container may leave an unconfirmed login in staging.
      for (const name of await readdir(this.root)) {
        const path = join(this.root, name)
        if (/^login-[a-zA-Z0-9]{6}$/.test(name) && path !== home) {
          await rm(path, { recursive: true, force: true })
        }
      }
      const device = parseDevice(
        await rpc.request('account/login/start', { type: 'chatgptDeviceCode' }),
      )
      this.pending = { rpc, device, home, expires: Date.now() + 15 * 60_000 }
      this.timer = setInterval(() => {
        if (this.pending && Date.now() >= this.pending.expires) {
          void this.action('cancel', device.loginId).catch(() => {})
        }
      }, 10000)
      return { state: 'pending', ...device }
    } catch (error) {
      await rpc.close()
      await rm(home, { recursive: true, force: true })
      throw error
    }
  }
}
