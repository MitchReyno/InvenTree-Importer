import { test } from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { readFile, writeFile, unlink } from 'node:fs/promises'
import { join } from 'node:path'
import { executorFixture, STOCK_WIRE, BARCODE } from '../support/executor.ts'
import { transaction } from '../../src/db/database.ts'
import { sha256 } from '../../src/db/authority.ts'
import { cancelRun, selectRecovery, snapshot, loadRun, retainOriginalSource } from '../../src/execution/authority.ts'
import { encodePlan, contributionBarcode } from '../../src/execution/plan.ts'
import { startApply } from '../../src/execution/supervisor.ts'
import { grantExecutor } from '../../src/execution/grants.ts'
import { verifyKnownStock } from '../../src/execution/verification.ts'

test('executor actual supervised HTTP: exact original wire, persistent fake restart, later round and deleted stock cannot replenish', { timeout: 30000 }, async () => {
  const f = await executorFixture()
  try {
    const run = await f.reserve()
    const child = await startApply({ databaseUrl: f.db.url,gateRoot: f.root,runId: run.runId,profile: f.profile })
    assert.deepEqual((await child.completed).confirmedStockIds,['7101'])
    const records = await f.fake.records()
    assert.deepEqual(records.map(row => [row.method,row.path,row.body.toString()]),[['GET','/api/part/29/',''],['GET','/api/stock/location/43/',''],['POST','/api/stock/',STOCK_WIRE]])
    assert.deepEqual(await f.fake.stocks(),[{ pk: '7101',part: '29',location: '43',quantity: '1.000001',barcode: BARCODE }])
    await f.restartFake()
    assert.equal((await f.fake.records()).length,3)
    assert.equal((await f.fake.stocks())[0].pk,'7101')
    assert.equal((await f.apply(run.runId)).state,'settled_complete')
    assert.equal((await f.fake.records()).length,3)
    // A second distinct contribution is allowed, not an accidental repeat of round A.
    const contributionKey = randomUUID()
    const secondPlan = { ...f.plan,operations: [{ ...f.plan.operations[0],operationKey: randomUUID(),contributionKey,quantity: '0.000001',location: null,barcode: contributionBarcode(f.plan.originalSourceKey,contributionKey) }] }
    const second = await f.reserve(f.reservation(secondPlan))
    assert.deepEqual((await f.apply(second.runId)).confirmedStockIds,['7102'])
    await f.db.pool.query('DELETE FROM fake_stock WHERE pk=7101')
    const sourceAlias = randomUUID()
    await f.db.pool.query('INSERT INTO executor_source VALUES ($1,$2,$3)',[f.plan.targetId,sourceAlias,f.plan.originalSourceKey])
    await assert.rejects(f.reserve(f.reservation({ ...f.plan,sourceId: sourceAlias })),/original_contribution_already_approved/)
    assert.deepEqual((await f.fake.stocks()).map(row => row.pk),['7102'])
    assert.equal((await f.fake.records()).filter(row => row.method === 'POST').length,2)
    await assert.rejects(transaction(f.db.pool,client => selectRecovery(client,run.runId,f.plan.operations[0].operationKey,f.authority.actor)),/create_not_recoverable/)
    const newOriginal = randomUUID(), newSource = randomUUID()
    await f.db.pool.query('INSERT INTO executor_source VALUES ($1,$2,$3)',[f.plan.targetId,newSource,newOriginal])
    const relabeled = { ...f.plan,sourceId: newSource,originalSourceKey: newOriginal,operations: [{ ...f.plan.operations[0],barcode: contributionBarcode(newOriginal,f.plan.operations[0].contributionKey) }] }
    await assert.rejects(f.reserve(f.reservation(relabeled)),/original_contribution_already_approved/)
  } finally { await f.dispose() }
})

test('approval canonical start-or-adopt, payload conflict, atomic rollback and immutable exact-parent SQL authority', async () => {
  const f = await executorFixture()
  try {
    const input = f.reservation(), run = await f.reserve(input)
    const replay = await f.reserve({ ...input,approvalId: randomUUID(),runId: randomUUID(),commandId: randomUUID() })
    assert.equal(replay.runId,run.runId)
    await assert.rejects(f.reserve({ ...input,...encodePlan({ ...f.plan,operations: [{ ...f.plan.operations[0],quantity: '2' }] }) }),/approval_payload_conflict/)
    for (const table of ['executor_approval','executor_run','executor_operation','command']) assert.equal((await f.db.pool.query(`SELECT count(*) FROM ${table}`)).rows[0].count,'1')
    for (const table of ['executor_approval','executor_run','executor_operation','executor_source','executor_deployment']) await assert.rejects(f.db.pool.query(`DELETE FROM ${table}`),/immutable_authority/)
    await assert.rejects(f.db.pool.query('UPDATE executor_operation SET contribution_key=$1',[randomUUID()]),/immutable_authority/)
    await assert.rejects(f.db.pool.query('UPDATE executor_guard SET original_key=original_key'),/immutable_authority/)
    await transaction(f.db.pool,client => retainOriginalSource(client,f.plan))
    await assert.rejects(transaction(f.db.pool,client => retainOriginalSource(client,{ ...f.plan,originalSourceKey: randomUUID() })),/original_source_binding_conflict/)
    const other = randomUUID()
    await assert.rejects(f.db.pool.query('INSERT INTO executor_intent(id,run_id,operation_key,attempt,kind,request_bytes,request_digest) VALUES ($1,$2,$3,1,$4,$5,$6)',[randomUUID(),run.runId,other,'create_stock',Buffer.from('{}'),Buffer.alloc(32)]),/foreign key/)
    await assert.rejects(transaction(f.db.pool,async client => { await cancelRun(client,run.runId,f.authority.actor); throw new Error('rollback_control') }),/rollback_control/)
    assert.equal((await f.db.pool.query('SELECT count(*) FROM executor_cancel')).rows[0].count,'0')
    assert.equal((await f.fake.records()).length,0)
  } finally { await f.dispose() }
})

test('accepted create loses response: one POST, unknown identity blocks all creates and original-run recovery', async () => {
  const f = await executorFixture()
  try {
    const run = await f.reserve()
    await f.fake.fault('drop_response')
    const result = await f.apply(run.runId)
    assert.equal(result.state,'recovery_required')
    assert.deepEqual(result.confirmedStockIds,[])
    assert.deepEqual((await f.fake.stocks()).map(row => row.pk),['7101'])
    await f.fake.fault('none')
    assert.equal((await f.apply(run.runId)).state,'recovery_required')
    await assert.rejects(transaction(f.db.pool,client => selectRecovery(client,run.runId,f.plan.operations[0].operationKey,f.authority.actor)),/create_not_recoverable/)
    const next = { ...f.plan,operations: [{ ...f.plan.operations[0],operationKey: randomUUID(),contributionKey: randomUUID() }] }
    next.operations[0].barcode = contributionBarcode(next.originalSourceKey,next.operations[0].contributionKey)
    await assert.rejects(f.reserve(f.reservation(next)),/source_reserved/)
    assert.equal((await f.fake.records()).filter(row => row.method === 'POST').length,1)
    assert.equal((await f.db.pool.query("SELECT outcome FROM executor_result r JOIN executor_intent i ON i.id=r.intent_id WHERE i.kind='create_stock'")).rows[0].outcome,'transport_loss')
  } finally { await f.dispose() }
})

test('cancellation wins before authorization; only selected ORIGINAL pending operation may resume', async () => {
  const f = await executorFixture()
  try {
    const run = await f.reserve()
    const result = await f.apply(run.runId,async (phase,kind) => {
      if (phase === 'before_authorize' && kind === 'create_stock') await transaction(f.db.pool,client => cancelRun(client,run.runId,f.authority.actor))
    })
    assert.equal(result.state,'settled_incomplete')
    assert.equal((await f.fake.records()).filter(row => row.method === 'POST').length,0)
    await assert.rejects(f.reserve(f.reservation()),/original_contribution_already_approved/)
    const recovery = await transaction(f.db.pool,client => selectRecovery(client,run.runId,f.plan.operations[0].operationKey,f.authority.actor))
    assert.deepEqual((await f.apply(run.runId,undefined,[recovery])).confirmedStockIds,['7101'])
    assert.equal((await f.fake.records()).filter(row => row.method === 'POST').length,1)
  } finally { await f.dispose() }
})

test('unknown create also blocks untouched siblings and previously selected recovery IDs', async () => {
  const f = await executorFixture()
  try {
    const contributionKey = randomUUID()
    const plan = { ...f.plan,operations: [...f.plan.operations,{ ...f.plan.operations[0],operationKey: randomUUID(),contributionKey,barcode: contributionBarcode(f.plan.originalSourceKey,contributionKey) }] }
    const run = await f.reserve(f.reservation(plan))
    const selectedBeforeUnknown = await transaction(f.db.pool,client => selectRecovery(client,run.runId,plan.operations[1].operationKey,f.authority.actor))
    await f.fake.fault('drop_response')
    assert.equal((await f.apply(run.runId)).state,'recovery_required')
    await f.fake.fault('none')
    await assert.rejects(transaction(f.db.pool,client => selectRecovery(client,run.runId,plan.operations[1].operationKey,f.authority.actor)),/create_not_recoverable/)
    assert.equal((await f.apply(run.runId,undefined,[selectedBeforeUnknown])).state,'recovery_required')
    assert.equal((await f.fake.records()).length,3)
    assert.equal((await f.fake.records()).filter(row => row.method === 'POST').length,1)
    assert.deepEqual((await f.fake.stocks()).map(row => row.pk),['7101'])
  } finally { await f.dispose() }
})

test('selected known-output verification retains matching/consumed/deleted receipts, never grants a second create', async () => {
  const f = await executorFixture()
  try {
    const run = await f.reserve()
    await f.apply(run.runId)
    const input = { runId: run.runId,operationKey: f.plan.operations[0].operationKey,actorId: f.authority.actor }
    assert.equal((await verifyKnownStock(f.db.pool,f.profile,input)).outcome,'matches')
    await f.db.pool.query("UPDATE fake_stock SET quantity='0' WHERE pk=7101")
    assert.equal((await verifyKnownStock(f.db.pool,f.profile,input)).outcome,'missing_or_changed')
    await f.db.pool.query('DELETE FROM fake_stock WHERE pk=7101')
    assert.equal((await verifyKnownStock(f.db.pool,f.profile,input)).outcome,'missing_or_changed')
    assert.deepEqual((await f.apply(run.runId)).confirmedStockIds,['7101'])
    await assert.rejects(f.reserve(f.reservation()),/original_contribution_already_approved/)
    assert.deepEqual((await f.db.pool.query('SELECT outcome FROM executor_verification v JOIN executor_intent i ON i.id=v.intent_id ORDER BY i.attempt')).rows.map(row => row.outcome),['matches','missing_or_changed','missing_or_changed'])
    assert.equal((await f.fake.records()).filter(row => row.method === 'POST').length,1)
    assert.equal((await f.fake.records()).filter(row => row.path === '/api/stock/7101/').length,3)
    assert.deepEqual(await f.fake.stocks(),[])
  } finally { await f.dispose() }
})

test('known-output verification rejects unresolved, unknown and conflicting create history before any GET', async () => {
  type Attempt = { certainty: 'confirmed' | 'unknown' | 'none' | null; outcome: 'response' | 'proven_not_sent' | null; pk: string | null }
  const confirmed: Attempt = { certainty: 'confirmed',outcome: 'response',pk: '7101' }
  const noEffect: Attempt = { certainty: 'none',outcome: 'proven_not_sent',pk: null }
  // Trusted retained-history fixtures exercise conservative rejection, including
  // inconsistent checkpoints that normal apply must never produce.
  const histories: { name: string; attempts: Attempt[] }[] = [
    { name: 'no create output',attempts: [] },
    { name: 'missing result and effect',attempts: [{ certainty: null,outcome: null,pk: null },confirmed] },
    { name: 'missing effect',attempts: [{ certainty: null,outcome: 'proven_not_sent',pk: null },confirmed] },
    { name: 'missing no-effect result',attempts: [{ ...noEffect,outcome: null },confirmed] },
    { name: 'unknown attributed create',attempts: [{ certainty: 'unknown',outcome: 'response',pk: '7100' },confirmed] },
    { name: 'none without positive no-dispatch proof',attempts: [{ ...noEffect,outcome: 'response' },confirmed] },
    { name: 'none with attributed PK',attempts: [{ ...noEffect,pk: '7100' },confirmed] },
    { name: 'confirmed without result',attempts: [{ ...confirmed,outcome: null }] },
    { name: 'duplicate confirmed output',attempts: [confirmed,confirmed] },
    { name: 'conflicting confirmed output',attempts: [confirmed,{ ...confirmed,pk: '7102' }] },
    { name: 'create after confirmed output',attempts: [confirmed,noEffect] },
  ]
  for (const history of histories) {
    const f = await executorFixture()
    try {
      const run = await f.reserve()
      for (const [index,attempt] of history.attempts.entries()) {
        const intentId = randomUUID(), bytes = Buffer.from(STOCK_WIRE)
        await f.db.pool.query(`INSERT INTO executor_intent(id,run_id,operation_key,attempt,kind,request_bytes,request_digest) VALUES ($1,$2,$3,$4,'create_stock',$5,$6)`,[intentId,run.runId,f.plan.operations[0].operationKey,index+1,bytes,sha256(bytes)])
        if (attempt.outcome) await f.db.pool.query('INSERT INTO executor_result(intent_id,outcome,status) VALUES ($1,$2,$3)',[intentId,attempt.outcome,attempt.outcome === 'response' ? 201 : null])
        if (attempt.certainty) await f.db.pool.query('INSERT INTO executor_effect VALUES ($1,$2,$3,$4,$5)',[intentId,run.runId,f.plan.operations[0].operationKey,attempt.certainty,attempt.pk])
      }
      await assert.rejects(verifyKnownStock(f.db.pool,f.profile,{ runId: run.runId,operationKey: f.plan.operations[0].operationKey,actorId: f.authority.actor }),/known_output_required/,history.name)
      assert.equal((await f.fake.records()).length,0,history.name)
      assert.equal((await f.db.pool.query("SELECT count(*) FROM executor_intent WHERE kind='get_stock'")).rows[0].count,'0',history.name)
    } finally { await f.dispose() }
  }
})

test('intent-only is unknown; known local pre-dispatch refusal is no-effect with selected recovery only', async () => {
  for (const mode of ['crash','stop'] as const) {
    const f = await executorFixture()
    try {
      const run = await f.reserve()
      let stopped = false
      const apply = f.apply(run.runId,async (phase,kind) => {
        if (phase === 'intent_committed' && kind === 'create_stock') {
          if (mode === 'crash') throw new Error('lost_commit_ack_fixture')
          stopped = true
        }
      },[],() => stopped)
      if (mode === 'crash') await assert.rejects(apply,/lost_commit_ack_fixture/)
      else await apply
      assert.equal((await f.fake.records()).filter(row => row.method === 'POST').length,0)
      const result = await snapshot(f.db.pool,run.runId)
      assert.equal(result.operations[0].certainty,mode === 'crash' ? 'unknown' : 'none')
      if (mode === 'crash') await assert.rejects(transaction(f.db.pool,client => selectRecovery(client,run.runId,f.plan.operations[0].operationKey,f.authority.actor)),/create_not_recoverable/)
      else {
        const recovery = await transaction(f.db.pool,client => selectRecovery(client,run.runId,f.plan.operations[0].operationKey,f.authority.actor))
        assert.deepEqual((await f.apply(run.runId,undefined,[recovery])).confirmedStockIds,['7101'])
      }
    } finally { await f.dispose() }
  }
})

test('missing/corrupt plan, immutable build/target and external disabled/epoch gate refuse before HTTP', async () => {
  const f = await executorFixture()
  try {
    const run = await f.reserve()
    const activationPath = join(f.root,'activation.json'), original = await readFile(activationPath,'utf8')
    for (const changes of [{ enabled: false },{ epoch: randomUUID() },{ origin: 'http://127.0.0.1:1' },{ build: 'changed' }]) {
      await writeFile(activationPath,JSON.stringify({ ...JSON.parse(original),...changes }))
      await assert.rejects(f.apply(run.runId),/apply_disabled|external_epoch_mismatch/)
    }
    await unlink(activationPath)
    await assert.rejects(f.apply(run.runId),/ENOENT/)
    await writeFile(activationPath,original,{ mode: 0o600 })
    // Trusted DBA corruption fixture, not a product path or supported recovery action.
    await f.db.pool.query('ALTER TABLE executor_approval DISABLE TRIGGER executor_approval_immutable')
    await f.db.pool.query('UPDATE executor_approval SET plan_bytes=$1',[Buffer.from('{}')])
    await assert.rejects(f.apply(run.runId),/retained_bytes_corrupt/)
    await f.db.pool.query('ALTER TABLE executor_approval ENABLE TRIGGER executor_approval_immutable')
    await assert.rejects(loadRun(f.db.pool,randomUUID()),/run_authority_missing/)
    assert.equal((await f.fake.records()).length,0)
  } finally { await f.dispose() }
})

test('later cancellation revokes selected recovery before intent; an already authorized request may finish, not the next lot', async () => {
  const f = await executorFixture()
  try {
    const contributionKey = randomUUID()
    const plan = { ...f.plan,operations: [...f.plan.operations,{ ...f.plan.operations[0],operationKey: randomUUID(),contributionKey,barcode: contributionBarcode(f.plan.originalSourceKey,contributionKey) }] }
    const run = await f.reserve(f.reservation(plan))
    const result = await f.apply(run.runId,async (phase,kind) => {
      if (phase === 'intent_committed' && kind === 'create_stock') await transaction(f.db.pool,client => cancelRun(client,run.runId,f.authority.actor))
    })
    assert.equal(result.state,'settled_incomplete')
    assert.deepEqual(result.confirmedStockIds,['7101'])
    assert.equal((await f.fake.records()).filter(row => row.method === 'POST').length,1)
    const recovery = await transaction(f.db.pool,client => selectRecovery(client,run.runId,plan.operations[1].operationKey,f.authority.actor))
    await transaction(f.db.pool,client => cancelRun(client,run.runId,f.authority.actor))
    assert.equal((await f.apply(run.runId,undefined,[recovery])).state,'settled_incomplete')
    assert.equal((await f.fake.records()).filter(row => row.method === 'POST').length,1)
  } finally { await f.dispose() }
})

test('malformed attributed PK and redirect remain unknown; no implicit redirect, no stock retry', async () => {
  for (const fault of ['malformed','redirect']) {
    const f = await executorFixture()
    try {
      const run = await f.reserve()
      await f.fake.fault(fault)
      const result = await f.apply(run.runId)
      assert.equal(result.state,'recovery_required')
      assert.deepEqual(result.attributedStockIds,fault === 'malformed' ? ['7101'] : [])
      const effects = (await f.db.pool.query('SELECT certainty,remote_pk FROM executor_effect')).rows
      assert.deepEqual(effects,[{ certainty: 'unknown',remote_pk: fault === 'malformed' ? '7101' : null }])
      assert.equal((await f.fake.records()).filter(row => row.method === 'POST').length,1)
      assert.equal((await f.fake.records()).filter(row => row.path === '/forbidden-redirect-sink').length,0)
      assert.equal((await f.apply(run.runId)).state,'recovery_required')
      assert.equal((await f.fake.records()).filter(row => row.method === 'POST').length,1)
    } finally { await f.dispose() }
  }
})

test('restricted apply role reads authority/locks but cannot approve, enroll, rewrite, truncate or erase history', async () => {
  const f = await executorFixture(), role = `intake_apply_${randomUUID().replaceAll('-','')}`
  let roleCreated = false
  try {
    const run = await f.reserve()
    await f.db.pool.query(`CREATE ROLE ${role} NOLOGIN`)
    roleCreated = true
    await grantExecutor(f.db.pool,role,'apply')
    const client = await f.db.pool.connect()
    try {
      await client.query(`SET ROLE ${role}`)
      assert.equal((await loadRun(client,run.runId)).runId,run.runId)
      for (const sql of ['TRUNCATE executor_intent','DELETE FROM executor_operation','INSERT INTO executor_approval SELECT * FROM executor_approval','INSERT INTO executor_source SELECT * FROM executor_source','ALTER TABLE executor_effect DISABLE TRIGGER ALL']) await assert.rejects(client.query(sql),/permission denied|must be owner/)
      await assert.rejects(client.query('UPDATE executor_run SET id=id'),/immutable_authority/)
      await assert.rejects(client.query('UPDATE target SET profile=profile'),/permission denied/)
      await client.query('BEGIN')
      await client.query('SELECT id FROM target FOR UPDATE')
      await client.query('SELECT id FROM executor_run FOR UPDATE')
      await client.query('ROLLBACK')
    } finally { await client.query('RESET ROLE'); client.release() }
  } finally {
    try { if (roleCreated) await f.db.pool.query(`DROP OWNED BY ${role}; DROP ROLE ${role}`) }
    finally { await f.dispose() }
  }
})

test('logical PG authority backup predates fake write: restoring missing history cannot authorize replacement under fresh run/source IDs', async () => {
  const f = await executorFixture()
  // Trusted SQL backup/restore of this test's canonical authority, not spike DB copying.
  // Keep fake request/effect tables and external deployment files OUTSIDE the restored set.
  const tables = ['executor_guard','executor_approval','command','outbox','executor_run','executor_operation','executor_cancel','executor_recovery','executor_intent','executor_result','executor_effect']
  try {
    await f.db.pool.query('CREATE SCHEMA owned_backup')
    for (const table of tables) await f.db.pool.query(`CREATE TABLE owned_backup.${table} AS TABLE ${table}`)
    const run = await f.reserve()
    assert.deepEqual((await f.apply(run.runId)).confirmedStockIds,['7101'])
    await transaction(f.db.pool,async client => {
      await client.query(`TRUNCATE ${tables.join(',')} CASCADE`)
      for (const table of tables) await client.query(`INSERT INTO ${table} OVERRIDING SYSTEM VALUE SELECT * FROM owned_backup.${table}`)
    })
    assert.equal((await f.db.pool.query('SELECT count(*) FROM executor_run')).rows[0].count,'0')
    const alias = randomUUID()
    await f.db.pool.query('INSERT INTO executor_source VALUES ($1,$2,$3)',[f.plan.targetId,alias,f.plan.originalSourceKey])
    const replacement = await f.reserve(f.reservation({ ...f.plan,sourceId: alias }))
    await assert.rejects(f.apply(replacement.runId),/restore_history_missing/)
    assert.deepEqual((await f.fake.stocks()).map(row => row.pk),['7101'])
    assert.equal((await f.fake.records()).filter(row => row.method === 'POST').length,1)
  } finally { await f.dispose() }
})
