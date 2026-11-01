import { randomUUID } from 'node:crypto'
import { lstat, open, readFile, readdir, mkdir, rmdir, unlink } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { Client, type Pool } from 'pg'
import { canonical, strictJson } from '@invimport/contracts/json'
import { id, type StockPlan } from './plan.ts'
import { checkDeployment } from './authority.ts'

async function privatePath(path: string, directory: boolean) {
  const stat = await lstat(path)
  if (
    stat.isSymbolicLink() ||
    stat.isDirectory() !== directory ||
    (!directory && !stat.isFile()) ||
    stat.uid !== process.getuid?.() ||
    stat.mode & 0o077
  ) {
    throw new Error('private_executor_state_required')
  }
}

export async function durableExclusive(path: string, bytes: string): Promise<void> {
  const file = await open(path, 'wx', 0o600)
  try {
    await file.writeFile(bytes)
    await file.sync()
  } finally {
    await file.close()
  }
  const directory = await open(resolve(path, '..'), 'r')
  try {
    await directory.sync()
  } finally {
    await directory.close()
  }
}

export interface Activation {
  enabled: boolean
  deploymentId: string
  epoch: string
  targetId: string
  contextId: string
  origin: string
  continuity: string
  build: string
  capability: string
}
/** Trusted deployment provisioning creates this private external state. Runtime never activates it.
 * Witnesses are NEVER deleted/overwritten, including after results and across later rounds.
 */
export class ExternalGate {
  readonly root: string

  constructor(root: string) {
    this.root = resolve(root)
  }

  async activation(): Promise<Activation> {
    await privatePath(this.root, true)
    const path = join(this.root, 'activation.json')
    await privatePath(path, false)
    const value = strictJson(await readFile(path, 'utf8')) as Activation
    if (!value || value.enabled !== true) {
      throw new Error('apply_disabled')
    }
    return value
  }

  async check(pool: Pick<Pool, 'query'>, plan: StockPlan): Promise<void> {
    const active = await this.activation()
    const deployment = await checkDeployment(pool, plan)
    const expected = {
      enabled: true,
      deploymentId: plan.deploymentId,
      epoch: plan.epoch,
      targetId: plan.targetId,
      contextId: plan.contextId,
      origin: deployment.origin,
      continuity: plan.continuity,
      build: plan.build,
      capability: plan.capability,
    }
    if (canonical(active) !== canonical(expected)) {
      throw new Error('external_epoch_mismatch')
    }
    await privatePath(join(this.root, 'witnesses'), true)
    for (const name of await readdir(join(this.root, 'witnesses'))) {
      if (!name.endsWith('.json')) {
        throw new Error('external_witness_corrupt')
      }
      const intentId = name.slice(0, -5)
      id(intentId)
      const path = join(this.root, 'witnesses', name)
      await privatePath(path, false)
      const bytes = await readFile(path, 'utf8')
      const retained = await pool.query(
        `SELECT i.request_digest,a.deployment_id,a.plan_digest FROM executor_intent i JOIN executor_run r ON r.id=i.run_id JOIN executor_approval a ON a.id=r.approval_id WHERE i.id=$1 AND i.kind='create_stock'`,
        [intentId],
      )
      const row = retained.rows[0]
      if (
        !row ||
        bytes !==
          canonical({
            intentId,
            deploymentId: row.deployment_id,
            requestDigest: row.request_digest.toString('hex'),
            planDigest: row.plan_digest.toString('hex'),
          })
      ) {
        throw new Error('restore_history_missing')
      }
    }
  }

  async witness(
    intentId: string,
    planDigest: Buffer,
    requestDigest: Buffer,
    deploymentId: string,
  ): Promise<void> {
    id(intentId)
    await durableExclusive(
      join(this.root, 'witnesses', `${intentId}.json`),
      canonical({
        intentId,
        deploymentId,
        requestDigest: requestDigest.toString('hex'),
        planDigest: planDigest.toString('hex'),
      }),
    )
  }

  /** Atomic non-expiring claim. No heartbeat, stale timeout, PID reuse or automatic unlink. */
  async claim(): Promise<{ token: string; releaseAfterReap: () => Promise<void> }> {
    await this.activation()
    const path = join(this.root, 'writer')
    await mkdir(path, { mode: 0o700 })
    const token = randomUUID()
    // If publication fails retain the claim; never infer that another child cannot exist.
    await durableExclusive(join(path, 'owner'), token)
    return {
      token,
      releaseAfterReap: async () => {
        if ((await readFile(join(path, 'owner'), 'utf8')) !== token) {
          throw new Error('host_owner_changed')
        }
        await unlink(join(path, 'owner'))
        await rmdir(path)
      },
    }
  }

  async requireClaim(token: string): Promise<void> {
    id(token)
    await privatePath(join(this.root, 'writer'), true)
    await privatePath(join(this.root, 'writer', 'owner'), false)
    if ((await readFile(join(this.root, 'writer', 'owner'), 'utf8')) !== token) {
      throw new Error('host_claim_missing')
    }
  }
}
/** A dedicated connection is never pooled/reconnected. Losing it is fatal to NEW sends.
 * The separate host claim remains held until the physical child has exited and been reaped.
 */
export class WriterConnection {
  private alive = false
  readonly client: Client

  constructor(url: string) {
    this.client = new Client({
      connectionString: url,
      connectionTimeoutMillis: 3000,
      query_timeout: 3000,
      statement_timeout: 3000,
      keepAlive: true,
    })
    this.client.on('error', () => {
      this.alive = false
    })
    this.client.on('end', () => {
      this.alive = false
    })
  }

  async acquire(deploymentId: string): Promise<void> {
    await this.client.connect()
    const result = await this.client.query(
      'SELECT pg_try_advisory_lock(hashtextextended($1,0)) AS held',
      [`bench-stock-writer:${deploymentId}`],
    )
    if (!result.rows[0].held) {
      throw new Error('database_writer_busy')
    }
    this.alive = true
  }

  async check(): Promise<void> {
    if (!this.alive) {
      throw new Error('writer_connection_lost')
    }
    try {
      await this.client.query('SELECT 1')
    } catch {
      this.alive = false
      throw new Error('writer_connection_lost')
    }
    if (!this.alive) {
      throw new Error('writer_connection_lost')
    }
  }

  async close(): Promise<void> {
    this.alive = false
    await this.client.end().catch(() => undefined)
  }
}
