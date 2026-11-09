import { mkdir, mkdtemp, readdir, rename, rm, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { AgentChild, record } from '../child.ts'
import { CODEX_CONFIG } from '../codex.ts'
import { requireCodexSessionVersion } from '../session-admission.ts'

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

export class CodexAccount {
  private lastStatusLogin?: string
  private pending?: Login
  private timer?: ReturnType<typeof setTimeout>
  private busy = false

  constructor(
    private readonly root: string,
    private readonly rpc: (root: string, home: string, exclusive: boolean) => AccountRpc = (
      root,
      home,
      exclusive,
    ) => new LoginRpc(root, home, exclusive),
  ) {}

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
    try {
      return await this.perform(action, loginId)
    } finally {
      this.busy = false
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
    const exists = await stat(active).then(
      () => true,
      (e) => {
        if (e.code === 'ENOENT') {
          return false
        }
        throw e
      },
    )
    if (exists) {
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
