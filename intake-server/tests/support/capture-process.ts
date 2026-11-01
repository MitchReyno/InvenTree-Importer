import { spawn, type ChildProcess } from 'node:child_process'
import { once } from 'node:events'
import { createServer as httpServer } from 'node:http'
import { randomUUID } from 'node:crypto'
import { isolatedDatabase, seedAuthority } from './database.ts'
import { grantFoundation } from '../../src/operations/grants.ts'
import { grantCapture } from '../../src/capture/grants.ts'
import { fileURLToPath } from 'node:url'

/** Owned fixture: real main.ts child + restricted role + bounded fake read endpoint, no real env. */
export async function captureProcess(port: number) {
  const db = await isolatedDatabase()
  const identity = await seedAuthority(db.pool)
  const role = `intake_${randomUUID().replaceAll('-', '')}`
  const password = randomUUID()
  await db.pool.query(
    `CREATE ROLE ${role} LOGIN PASSWORD '${password}' NOSUPERUSER NOCREATEDB NOCREATEROLE CONNECTION LIMIT 4`,
  )
  await grantFoundation(db.pool, role)
  await grantCapture(db.pool, role)
  const url = new URL(db.url)
  url.username = role
  url.password = password
  const requests: { method: string; path: string }[] = []
  const fake = httpServer((req, res) => {
    requests.push({ method: req.method ?? '', path: req.url ?? '' })
    const match = /^\/api\/(part|stock\/location)\/([1-9][0-9]*)\/$/.exec(req.url ?? '')
    if (req.method !== 'GET' || !match) {
      res.writeHead(405).end()
      return
    }
    const name =
      match[1] === 'part'
        ? '100 Ω resistor'
        : ({ '104': 'Drawer 4', '105': 'Drawer 5', '108': 'Drawer 8' }[match[2]] ??
          'Unknown fixture location')
    res
      .writeHead(200, { 'content-type': 'application/json' })
      .end(JSON.stringify({ pk: match[2], name }))
  })
  fake.listen(0, '127.0.0.1')
  await once(fake, 'listening')
  const address = fake.address()
  if (!address || typeof address === 'string') {
    throw new Error('fixture_address_required')
  }
  const origin = `http://127.0.0.1:${port}`
  let child: ChildProcess | undefined
  let logs = ''
  async function stop() {
    if (child && child.exitCode === null) {
      const exited = once(child, 'exit')
      child.kill('SIGTERM')
      await exited
    }
  }
  async function start() {
    child = spawn(process.execPath, ['--import', 'tsx', 'src/main.ts'], {
      cwd: fileURLToPath(new URL('../../', import.meta.url)),
      env: {
        PATH: process.env.PATH,
        HOME: process.env.HOME,
        TMPDIR: process.env.TMPDIR,
        INTAKE_ORIGIN: origin,
        INTAKE_ACTOR_ID: identity.actor,
        INTAKE_TARGET_ID: identity.target,
        INTAKE_TARGET_CONTEXT_ID: identity.context,
        INTAKE_CREDENTIAL_REF: 'controlled_capture_fixture',
        INTAKE_DEV_API_KEY: 'fixture-only-not-a-secret',
        INTAKE_DATABASE_URL: url.toString(),
        INTAKE_READ_ORIGIN: `http://127.0.0.1:${address && typeof address !== 'string' ? address.port : 0}`,
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    child.stdout?.on('data', (b) => {
      logs += b.toString()
    })
    child.stderr?.on('data', (b) => {
      logs += b.toString()
    })
    for (let i = 0; i < 100; i++) {
      if (child.exitCode !== null) {
        throw new Error(`capture_child_failed:${logs}`)
      }
      try {
        const response = await fetch(`${origin}/api/v1/bootstrap`)
        if (response.ok) {
          return (await response.json()) as { csrf_token: string }
        }
      } catch {
        /* bounded readiness poll */
      }
      await new Promise((resolve) => setTimeout(resolve, 50))
    }
    throw new Error('capture_child_start_timeout')
  }
  return {
    db,
    origin,
    identity,
    requests,
    start,
    stop,
    async dispose() {
      await stop()
      fake.close()
      await once(fake, 'close')
      await db.pool.query(`DROP OWNED BY ${role}`)
      await db.pool.query(`DROP ROLE ${role}`)
      await db.dispose()
    },
  }
}
