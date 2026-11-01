import { test } from 'node:test'
import assert from 'node:assert/strict'
import { fork, execFile, type ChildProcess } from 'node:child_process'
import { once } from 'node:events'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import { randomUUID } from 'node:crypto'
import { DBOS, DBOSClient } from '@dbos-inc/dbos-sdk'
import { strictJson } from '@invimport/contracts/json'
import { executorFixture } from '../support/executor.ts'
import { commitAckProxy } from '../fixtures/commit-ack-proxy.ts'
import { database } from '../../src/db/database.ts'
import { executorTransaction as transaction } from '../../src/execution/transaction.ts'
import { cancelRun, reserveApprovedStock, selectRecovery, snapshot } from '../../src/execution/authority.ts'
import { contributionBarcode } from '../../src/execution/plan.ts'
import { executeRun } from '../../src/execution/apply.ts'
import { WriterConnection } from '../../src/execution/ownership.ts'
import { startApply } from '../../src/execution/supervisor.ts'
import { deliverStockCommand } from '../../src/execution/delivery.ts'

async function until<T>(read: () => Promise<T>, predicate: (value: T) => boolean) {
  const deadline = Date.now()+10000
  for (;;) {
    const value = await read()
    if (predicate(value)) return value
    if (Date.now() > deadline) throw new Error('executor_checkpoint_timeout')
    await new Promise(resolve => setTimeout(resolve,25))
  }
}
async function reap(child: ChildProcess) {
  if (child.exitCode !== null || child.signalCode !== null) return
  const exit = once(child,'exit'); child.kill('SIGKILL'); await exit
}

test('bounded stock outbox uses actual DBOS public full-payload adoption; scheduler ACK grants zero physical writes', { timeout: 30000 }, async () => {
  const f = await executorFixture()
  let scheduler: DBOSClient | undefined
  try {
    await DBOS.migrate(f.db.url)
    scheduler = await DBOSClient.create({ systemDatabaseUrl: f.db.url,systemDatabasePoolSize: 2 })
    const run = await f.reserve()
    assert.equal(await deliverStockCommand(f.db.pool,scheduler,run.commandId),'acked')
    assert.equal(await deliverStockCommand(f.db.pool,scheduler,run.commandId),'acked')
    const command = (await f.db.pool.query('SELECT * FROM command WHERE id=$1',[run.commandId])).rows[0]
    assert.deepEqual((await scheduler.getWorkflow(command.workflow_id))?.input,[strictJson(command.payload_bytes.toString('utf8'))])
    assert.equal((await f.fake.records()).length,0)
    assert.equal((await f.db.pool.query('SELECT count(*) FROM executor_intent')).rows[0].count,'0')
    await assert.rejects(deliverStockCommand(f.db.pool,scheduler,randomUUID()),/stock_command_authority_missing/)
    // A genuine command and scheduler identity with a changed payload may not be adopted.
    await transaction(f.db.pool,client => cancelRun(client,run.runId,f.authority.actor))
    assert.equal((await f.apply(run.runId)).state,'settled_incomplete')
    // Different retained original contribution, not a new namespace for the old operation.
    const contributionKey = randomUUID()
    const next = await f.reserve(f.reservation({ ...f.plan,operations: [{ ...f.plan.operations[0],operationKey: randomUUID(),contributionKey,barcode: contributionBarcode(f.plan.originalSourceKey,contributionKey) }] }))
    const changed = (await f.db.pool.query('SELECT * FROM command WHERE id=$1',[next.commandId])).rows[0]
    await scheduler.enqueue({ workflowID: changed.workflow_id,workflowName: 'intakeCommand',queueName: 'bench-apply',appVersion: f.plan.build },{ runId: next.runId,approvalId: next.approvalId,planDigest: 'changed' })
    assert.equal(await deliverStockCommand(f.db.pool,scheduler,next.commandId),'conflict')
    assert.equal((await f.db.pool.query('SELECT conflict_code FROM outbox WHERE command_id=$1',[next.commandId])).rows[0].conflict_code,'payload_conflict')
    assert.equal((await f.fake.records()).length,0)
  } finally { await scheduler?.destroy(); await f.dispose() }
})

test('REAL PG TCP lost approval COMMIT ACK adopts original run; lost intent COMMIT ACK produces zero POSTs and unknown', { timeout: 30000 }, async () => {
  const f = await executorFixture(), proxy = await commitAckProxy(f.db.url), proxied = database(proxy.url)
  const writer = new WriterConnection(f.db.url)
  let claim: Awaited<ReturnType<typeof f.gate.claim>> | undefined
  try {
    const input = f.reservation()
    proxy.dropNextCommit()
    await assert.rejects(transaction(proxied.pool,client => reserveApprovedStock(client,input)),/Connection terminated/)
    assert.equal(proxy.losses,1)
    assert.equal((await f.db.pool.query('SELECT count(*) FROM executor_approval')).rows[0].count,'1')
    const adopted = await f.reserve(input)
    assert.equal(adopted.runId,input.runId)
    claim = await f.gate.claim()
    await writer.acquire(f.plan.deploymentId)
    await assert.rejects(executeRun({ pool: proxied.pool,writer,gate: f.gate,claimToken: claim.token,profile: f.profile,stopped: () => false,checkpoint: async (phase,kind) => {
      if (phase === 'before_authorize' && kind === 'create_stock') proxy.dropNextCommit()
    } },input.runId),/Connection terminated/)
    assert.equal(proxy.losses,2)
    assert.equal((await f.fake.records()).filter(row => row.method === 'POST').length,0)
    assert.equal((await snapshot(f.db.pool,input.runId)).state,'recovery_required')
    assert.equal((await f.db.pool.query("SELECT count(*) FROM executor_intent WHERE kind='create_stock'")).rows[0].count,'1')
    await assert.rejects(transaction(f.db.pool,client => selectRecovery(client,input.runId,f.plan.operations[0].operationKey,f.authority.actor)),/create_not_recoverable/)
  } finally { await writer.close(); await claim?.releaseAfterReap(); await proxied.close(); await proxy.close(); await f.dispose() }
})

test('physical SIGKILL after intent/result: no retry for unknown, confirmed result survives and yields original stock PK', { timeout: 30000 }, async () => {
  for (const phase of ['intent_committed','result_committed'] as const) {
    const f = await executorFixture()
    let child: ChildProcess | undefined
    const claim = await f.gate.claim()
    try {
      const run = await f.reserve()
      child = fork(fileURLToPath(new URL('./executor-worker.ts',import.meta.url)),[],{ execArgv: ['--import','tsx'],env: { PATH: process.env.PATH },stdio: ['ignore','ignore','ignore','ipc'] })
      const messages: { kind: string }[] = []
      child.on('message',value => messages.push(value as { kind: string }))
      child.send({ databaseUrl: f.db.url,gateRoot: f.root,claimToken: claim.token,runId: run.runId,profile: f.profile,recoveryIds: [],pause: phase,pauseKind: 'create_stock' })
      await until(async () => messages,value => value.some(row => row.kind === 'paused'))
      await reap(child); child = undefined
      await claim.releaseAfterReap()
      const output = await f.apply(run.runId)
      assert.equal(output.state,phase === 'intent_committed' ? 'recovery_required' : 'settled_complete')
      assert.deepEqual(output.confirmedStockIds,phase === 'intent_committed' ? [] : ['7101'])
      assert.equal((await f.fake.records()).filter(row => row.method === 'POST').length,phase === 'intent_committed' ? 0 : 1)
    } finally {
      if (child) { await reap(child); await claim.releaseAfterReap() }
      await f.dispose()
    }
  }
})

test('original physical child survives dedicated PG connection loss; host exclusion blocks replacement until reaped', { timeout: 30000 }, async () => {
  const f = await executorFixture()
  const claim = await f.gate.claim()
  let child: ChildProcess | undefined
  try {
    const run = await f.reserve()
    child = fork(fileURLToPath(new URL('./executor-worker.ts',import.meta.url)),[],{ execArgv: ['--import','tsx'],env: { PATH: process.env.PATH },stdio: ['ignore','ignore','ignore','ipc'] })
    const messages: { kind: string; pid?: number }[] = []
    child.on('message',value => messages.push(value as { kind: string; pid?: number }))
    child.send({ databaseUrl: f.db.url,gateRoot: f.root,claimToken: claim.token,runId: run.runId,profile: f.profile,recoveryIds: [],pause: 'intent_committed',pauseKind: 'create_stock' })
    await until(async () => messages,value => value.some(row => row.kind === 'paused'))
    const pid = messages.find(row => row.kind === 'writer')!.pid
    assert.equal((await f.db.pool.query('SELECT pg_terminate_backend($1) AS terminated',[pid])).rows[0].terminated,true)
    // Advisory lock is demonstrably available while the old OS process is still alive.
    const other = new WriterConnection(f.db.url)
    try { await other.acquire(f.plan.deploymentId); await other.check() } finally { await other.close() }
    assert.equal(child.exitCode,null)
    await assert.rejects(startApply({ databaseUrl: f.db.url,gateRoot: f.root,runId: run.runId,profile: f.profile }),/EEXIST/)
    assert.equal((await f.fake.records()).filter(row => row.method === 'POST').length,0)
    const exit = once(child,'exit'); child.send({ kind: 'continue' }); await exit; child = undefined
    await claim.releaseAfterReap()
    // No send happened: positive original-process pre-dispatch refusal is retained.
    assert.equal((await snapshot(f.db.pool,run.runId)).operations[0].certainty,'none')
    const recovery = await transaction(f.db.pool,client => selectRecovery(client,run.runId,f.plan.operations[0].operationKey,f.authority.actor))
    const restarted = await startApply({ databaseUrl: f.db.url,gateRoot: f.root,runId: run.runId,profile: f.profile,recoveryIds: [recovery] })
    assert.deepEqual((await restarted.completed).confirmedStockIds,['7101'])
    assert.equal((await f.fake.records()).filter(row => row.method === 'POST').length,1)
  } finally {
    if (child) { await reap(child); await claim.releaseAfterReap() }
    await f.dispose()
  }
})

test('supervisor SIGKILL while original physical child HTTP remains in flight: retained non-stealable host claim, exactly one stock', { timeout: 30000 }, async () => {
  const f = await executorFixture()
  let supervisor: ChildProcess | undefined, physicalPid: number | undefined
  const processState = async () => {
    if (!physicalPid) return ''
    try { return (await promisify(execFile)('ps',['-o','stat=','-p',String(physicalPid)])).stdout.trim() } catch { return '' }
  }
  try {
    const run = await f.reserve()
    await f.fake.fault('hold_response')
    supervisor = fork(fileURLToPath(new URL('./executor-supervisor.ts',import.meta.url)),[],{ execArgv: ['--import','tsx'],env: { PATH: process.env.PATH },stdio: ['ignore','ignore','ignore','ipc'] })
    supervisor.on('message',(value: { kind: string; pid: number }) => { if (value.kind === 'physical_child') physicalPid = value.pid })
    supervisor.send({ databaseUrl: f.db.url,gateRoot: f.root,runId: run.runId,profile: f.profile })
    await until(() => f.fake.stocks(),value => value.length === 1)
    assert.ok(physicalPid)
    await reap(supervisor); supervisor = undefined
    assert.notEqual(await processState(),'')
    await assert.rejects(startApply({ databaseUrl: f.db.url,gateRoot: f.root,runId: run.runId,profile: f.profile }),/EEXIST/)
    await f.fake.fault('none')
    await until(processState,value => value === '' || value.startsWith('Z'))
    assert.equal((await f.fake.records()).filter(row => row.method === 'POST').length,1)
    assert.deepEqual((await f.fake.stocks()).map(row => row.pk),['7101'])
    // Even AFTER orphan exit, no timeout/PID check steals the parent's retained claim.
    await assert.rejects(startApply({ databaseUrl: f.db.url,gateRoot: f.root,runId: run.runId,profile: f.profile }),/EEXIST/)
  } finally {
    if (supervisor) await reap(supervisor)
    await f.fake.fault('none')
    if (physicalPid) await until(processState,value => value === '' || value.startsWith('Z'))
    await f.dispose()
  }
})
