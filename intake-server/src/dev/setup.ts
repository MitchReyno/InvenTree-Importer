import { randomBytes, randomUUID } from 'node:crypto'
import { mkdir, writeFile, access } from 'node:fs/promises'
import { join } from 'node:path'
import { manualFixture } from '../../tests/support/manual.ts'
import { database } from '../db/database.ts'
import { migrate } from '../operations/migrate.ts'
import { grantProcessing } from '../processing/grants.ts'
import { grantMedia } from '../media/grants.ts'
import { grantCaptureRead } from '../capture/grants.ts'
import { grantProjection } from '../operations/grants.ts'
import {
  assertStateServer,
  readDevState,
  schedulerUrl,
  type DevState,
  type FakeDevState,
} from './state.ts'
import { reownProcessingRows } from './scheduler-owner.ts'
import { developmentAdmin, serverIdentity } from './pg-identity.ts'
import { developmentTarget, type DevelopmentTarget } from './target.ts'
import { readonlyState } from './readonly-setup.ts'
import { readLocalInventree } from './local-inventree.ts'
import { grantFoundation } from '../operations/grants.ts'
import { grantCapture } from '../capture/grants.ts'
import { grantManual } from '../review/grants.ts'

function adminUrl() {
  return developmentAdmin(process.env)
}

async function newState(
  root: string,
  target: DevelopmentTarget,
  serverId: string,
): Promise<DevState> {
  await writeFile(
    join(root, 'initializing'),
    'Retained first-setup marker. app.json records completed setup; inspect interrupted setup before retrying.\n',
    { flag: 'wx', mode: 0o600 },
  )
  const retained = join(root, 'retained')
  await mkdir(retained, { mode: 0o700 })
  const admin = await adminUrl()
  process.env.INTAKE_TEST_ADMIN_URL = admin.toString()
  process.env.INTAKE_TEST_ALLOW_CREATE_DATABASE = 'owned-sandbox'
  if (target.kind !== 'fake') {
    const instanceId =
      target.kind === 'local-inventree'
        ? (await readLocalInventree(process.env)).instanceId
        : undefined
    const state = { ...(await readonlyState(root, target, instanceId)), serverId }
    await writeFile(join(root, 'app.json'), JSON.stringify(state), { flag: 'wx', mode: 0o600 })
    return state
  }
  const fixture = await manualFixture({ media: true, effects: true, retainedRoot: retained })
  try {
    await fixture.stop()
    await grantProcessing(fixture.db.pool, fixture.api.name)
    await fixture.db.pool.query(`ALTER ROLE ${fixture.scheduler.name} CONNECTION LIMIT 12`)

    async function role(purpose: 'processing' | 'media' | 'fake') {
      const name = `intake_${randomUUID().replaceAll('-', '')}`
      const password = randomUUID()
      await fixture.db.pool.query(
        `CREATE ROLE ${name} LOGIN PASSWORD '${password}' NOSUPERUSER NOCREATEDB NOCREATEROLE CONNECTION LIMIT 4`,
      )
      if (purpose === 'processing') {
        await grantProcessing(fixture.db.pool, name, 'runner')
      }
      if (purpose === 'media') {
        await grantMedia(fixture.db.pool, name, 'decoder')
        await grantProjection(fixture.db.pool, name)
        await grantCaptureRead(fixture.db.pool, name)
        await fixture.db.pool.query(`GRANT UPDATE(revision) ON media_batch TO ${name}`)
      }
      if (purpose === 'fake') {
        const tables = await fixture.db.pool.query<{ tablename: string }>(
          "SELECT tablename FROM pg_tables WHERE schemaname='public' AND tablename LIKE 'fake\\_%' ESCAPE '\\'",
        )
        for (const table of tables.rows) {
          if (!/^fake_[a-z_]+$/.test(table.tablename)) {
            throw new Error('invalid_fake_table')
          }
          await fixture.db.pool.query(
            `GRANT SELECT,INSERT,UPDATE,DELETE ON ${table.tablename} TO ${name}`,
          )
        }
        const sequences = await fixture.db.pool.query<{ sequencename: string }>(
          "SELECT sequencename FROM pg_sequences WHERE schemaname='public' AND sequencename LIKE 'fake\\_%' ESCAPE '\\'",
        )
        for (const sequence of sequences.rows) {
          if (!/^fake_[a-z_]+$/.test(sequence.sequencename)) {
            throw new Error('invalid_fake_sequence')
          }
          await fixture.db.pool.query(
            `GRANT USAGE,SELECT ON SEQUENCE ${sequence.sequencename} TO ${name}`,
          )
        }
      }
      const url = new URL(fixture.api.url)
      url.username = name
      url.password = password
      return url.toString()
    }

    const state: FakeDevState = {
      version: 1,
      serverId,
      databaseName: fixture.db.name,
      identity: fixture.identity,
      apiUrl: fixture.api.url,
      processingUrl: await role('processing'),
      mediaUrl: await role('media'),
      fakeUrl: await role('fake'),
      runnerConfig: fixture.runnerConfig,
      runnerConfigPath: fixture.runnerConfigPath,
      blobRoot: join(retained, 'blobs'),
      channelSecret: randomBytes(32).toString('hex'),
    }
    await writeFile(join(root, 'app.json'), JSON.stringify(state), { flag: 'wx', mode: 0o600 })
    return state
  } finally {
    await fixture.fake.close()
    await Promise.all([
      fixture.api.close(),
      fixture.runner.close(),
      fixture.apply.close(),
      fixture.scheduler.close(),
      fixture.db.close(),
    ])
  }
}

async function main() {
  const root = process.env.INTAKE_APP_STATE
  if (!root) {
    throw new Error('dev_state_required')
  }
  const target = developmentTarget(process.env)
  const serverId = await serverIdentity(process.env)
  try {
    await access(join(root, 'app.json'))
  } catch (error) {
    if (!error || typeof error !== 'object' || !('code' in error) || error.code !== 'ENOENT') {
      throw error
    }
    await newState(root, target, serverId)
  }
  const state = await readDevState(root)
  assertStateServer(state, serverId)
  const instanceId =
    target.kind === 'local-inventree'
      ? (await readLocalInventree(process.env)).instanceId
      : undefined
  if (
    (state.version === 1 && target.kind !== 'fake') ||
    (state.version === 2 &&
      (target.kind !== 'read-only' ||
        state.target.origin !== target.origin ||
        state.target.credentialRef !== target.credentialRef)) ||
    (state.version === 3 && (target.kind !== 'local-inventree' || state.instanceId !== instanceId))
  ) {
    throw new Error('development_target_binding_changed')
  }
  const url = await adminUrl()
  url.pathname = `/${state.databaseName}`
  const db = database(url.toString())
  try {
    await migrate(db.pool)
    const apiRole = new URL(state.apiUrl).username
    const processingRole = new URL(state.processingUrl).username
    const mediaRole = new URL(state.mediaUrl).username
    await grantFoundation(db.pool, apiRole)
    await grantCapture(db.pool, apiRole)
    await grantManual(db.pool, apiRole, 'api')
    await grantMedia(db.pool, apiRole, 'api')
    await grantProcessing(db.pool, apiRole)
    await grantProcessing(db.pool, processingRole, 'runner')
    await grantMedia(db.pool, mediaRole, 'decoder')
    await grantProjection(db.pool, mediaRole)
    await grantCaptureRead(db.pool, mediaRole)
    await db.pool.query(`GRANT UPDATE(revision) ON media_batch TO ${mediaRole}`)
  } finally {
    await db.close()
  }
  await reownProcessingRows(schedulerUrl(state))
  process.stdout.write(
    'Owned development state ready; data retained across application restarts.\n',
  )
}

main().catch((error: unknown) => {
  // Driver diagnostics may carry configuration; name only stable refusal codes.
  const message = error instanceof Error ? error.message : ''
  const code = /^[a-z_]+$/.test(message) ? ` (${message})` : ''
  process.stderr.write(
    `Development setup refused${code}; inspect owned state and PostgreSQL. No retained data was removed.\n`,
  )
  process.exitCode = 1
})
