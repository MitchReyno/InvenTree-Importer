import { test } from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { spawn, type ChildProcess } from 'node:child_process'
import { once } from 'node:events'
import { fileURLToPath } from 'node:url'
import { DBOS, DBOSClient } from '@dbos-inc/dbos-sdk'
import { isolatedDatabase, seedAuthority } from '../support/database.ts'
import { canonical } from '@invimport/contracts/json'
import { sha256 } from '../../src/db/authority.ts'
import { deliverCommand } from '../../src/workers/delivery.ts'

async function until<T>(
  read: () => Promise<T>,
  predicate: (value: T) => boolean,
  milliseconds = 20000,
): Promise<T> {
  const deadline = Date.now() + milliseconds
  for (;;) {
    const value = await read()
    if (predicate(value)) return value
    if (Date.now() > deadline) throw new Error('qualification_wait_timeout')
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
}
async function stop(child: ChildProcess, signal: NodeJS.Signals) {
  if (child.exitCode !== null || child.signalCode !== null) return
  const exited = once(child, 'exit')
  child.kill(signal)
  await exited
}
async function worker(url: string, version: string): Promise<ChildProcess> {
  const child = spawn(
    process.execPath,
    ['--import', 'tsx', fileURLToPath(new URL('./dbos-worker.ts', import.meta.url))],
    {
      env: {
        PATH: process.env.PATH,
        HOME: process.env.HOME,
        INTAKE_QUALIFICATION_DATABASE_URL: url,
        INTAKE_QUALIFICATION_VERSION: version,
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  )
  let output = ''
  child.stdout!.on('data', (value) => {
    output += String(value)
  })
  child.stderr!.resume()
  try {
    await until(
      async () => output,
      (value) => value.includes('READY'),
    )
    return child
  } catch (error) {
    await stop(child, 'SIGKILL')
    throw error
  }
}
test(
  'DBOS 5.4 public API: full duplicate payload/version, outbox loss/redelivery, kill/recover, worker version refusal',
  { timeout: 90000 },
  async () => {
    const db = await isolatedDatabase()
    let client: DBOSClient | undefined, child: ChildProcess | undefined
    try {
      await DBOS.migrate(db.url)
      client = await DBOSClient.create({ systemDatabaseUrl: db.url, systemDatabasePoolSize: 2 })
      const scheduler = client
      const authority = await seedAuthority(db.pool)
      async function command(
        value: string,
        workflowId = randomUUID(),
        version = 'qualification-v1',
      ) {
        const id = randomUUID(),
          bytes = Buffer.from(canonical({ handler_version: version, value }))
        await db.pool.query(
          'INSERT INTO command(id,actor_id,target_id,target_context_id,kind,handler_version,workflow_id,queue_name,payload_bytes,payload_digest) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)',
          [
            id,
            authority.actor,
            authority.target,
            authority.context,
            'qualification',
            version,
            workflowId,
            'qualification',
            bytes,
            sha256(bytes),
          ],
        )
        await db.pool.query('INSERT INTO outbox(command_id) VALUES ($1)', [id])
        return { id, workflowId, version, bytes }
      }
      const first = await command('original')
      // Crash boundary fixture: scheduler committed, dispatcher did not receive/commit ACK.
      await scheduler.enqueue(
        {
          workflowID: first.workflowId,
          workflowName: 'intakeCommand',
          queueName: 'qualification',
          appVersion: first.version,
        },
        JSON.parse(first.bytes.toString()),
      )
      assert.equal(
        (await db.pool.query('SELECT acked_at FROM outbox WHERE command_id=$1', [first.id])).rows[0]
          .acked_at,
        null,
      )
      assert.equal(await deliverCommand(db.pool, scheduler, first.id), 'acked')
      assert.equal(await deliverCommand(db.pool, scheduler, first.id), 'acked')
      assert.deepEqual((await scheduler.getWorkflow(first.workflowId))?.input, [
        { handler_version: first.version, value: 'original' },
      ])
      // Existing scheduler identity cannot be adopted under changed payload/function/queue/version.
      for (const changes of [
        { value: 'changed' },
        { version: 'qualification-v2' },
        { workflowName: 'other' },
        { queueName: 'other' },
      ]) {
        const item = await command('expected')
        await scheduler.enqueue(
          {
            workflowID: item.workflowId,
            workflowName: changes.workflowName ?? 'intakeCommand',
            queueName: changes.queueName ?? 'qualification',
            appVersion: changes.version ?? item.version,
          },
          { handler_version: item.version, value: changes.value ?? 'expected' },
        )
        assert.equal(await deliverCommand(db.pool, scheduler, item.id), 'conflict')
      }
      assert.equal(
        (
          await db.pool.query(
            'SELECT count(*) FROM outbox WHERE conflict_code IS NOT NULL AND acked_at IS NULL',
          )
        ).rows[0].count,
        '4',
      )
      child = await worker(db.url, 'qualification-v1')
      assert.equal(
        await scheduler.getEvent(first.workflowId, 'checkpoint', { timeoutSeconds: 10 }),
        'original',
      )
      await stop(child, 'SIGKILL')
      child = undefined
      const interrupted = await scheduler.getWorkflow(first.workflowId)
      assert.equal(interrupted?.status, 'PENDING')
      // Wrong application version must not recover v1 work.
      child = await worker(db.url, 'qualification-v2')
      await new Promise((resolve) => setTimeout(resolve, 2500))
      assert.equal((await scheduler.getWorkflow(first.workflowId))?.status, 'PENDING')
      // Even scheduler metadata stamped v2 cannot authorize v1 handler input on a v2 worker.
      const mismatch = await scheduler.enqueue(
        {
          workflowID: randomUUID(),
          workflowName: 'intakeCommand',
          queueName: 'qualification',
          appVersion: 'qualification-v2',
        },
        { handler_version: 'qualification-v1', value: 'must-not-run' },
      )
      await assert.rejects(mismatch.getResult(), /worker_version_conflict/)
      await stop(child, 'SIGTERM')
      child = undefined
      child = await worker(db.url, 'qualification-v1')
      await scheduler.send(first.workflowId, 'finish', 'finish', 'qualification-finish')
      const result = await until(
        () => scheduler.getWorkflow(first.workflowId),
        (value) => value?.status === 'SUCCESS',
      )
      assert.equal(result?.output, 'original')
      assert.equal((await scheduler.listWorkflows({ workflowIDs: [first.workflowId] })).length, 1)
      assert.equal(await deliverCommand(db.pool, scheduler, first.id), 'acked')
    } finally {
      if (child) await stop(child, 'SIGKILL')
      await client?.destroy()
      await db.dispose()
    }
  },
)
