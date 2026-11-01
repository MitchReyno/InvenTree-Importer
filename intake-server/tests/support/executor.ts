import { randomUUID } from 'node:crypto'
import { mkdtemp, mkdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { canonical } from '@invimport/contracts/json'
import { isolatedDatabase, seedAuthority } from './database.ts'
import { inventoryFake } from '../fixtures/inventory-fake.ts'
import { transaction } from '../../src/db/database.ts'
import { reserveApprovedStock, retainOriginalSource, type Reservation } from '../../src/execution/authority.ts'
import { CAPABILITY, EXECUTOR_BUILD, encodePlan, type StockPlan } from '../../src/execution/plan.ts'
import { ExternalGate, WriterConnection, durableExclusive } from '../../src/execution/ownership.ts'
import type { TargetProfile } from '../../src/inventory/transport.ts'
import { executeRun, type ApplyDependencies } from '../../src/execution/apply.ts'

// Deliberately asymmetric literal source/contribution identities for independent wire assertions.
export const ORIGINAL = '10000000-0000-4000-8000-000000000011'
export const CONTRIBUTION = '20000000-0000-4000-8000-000000000022'
export const BARCODE = 'bi1:10000000-0000-4000-8000-000000000011:20000000-0000-4000-8000-000000000022'
export const STOCK_WIRE = '{"barcode":"bi1:10000000-0000-4000-8000-000000000011:20000000-0000-4000-8000-000000000022","location":"43","part":"29","quantity":"1.000001"}'
export async function executorFixture() {
  const db = await isolatedDatabase()
  const root = await mkdtemp(join(tmpdir(),'bench-executor-'))
  let fake: Awaited<ReturnType<typeof inventoryFake>> | undefined
  try {
    fake = await inventoryFake(db.pool)
    const authority = await seedAuthority(db.pool)
    const plan: StockPlan = { version: 'bench-stock-plan/1',deploymentId: randomUUID(),targetId: authority.target,contextId: authority.context,epoch: randomUUID(),build: EXECUTOR_BUILD,continuity: 'owned-fake-instance-17',capability: CAPABILITY,sourceId: randomUUID(),originalSourceKey: ORIGINAL,operations: [{ operationKey: randomUUID(),contributionKey: CONTRIBUTION,part: '29',location: '43',quantity: '1.000001',barcode: BARCODE }] }
    await db.pool.query('INSERT INTO executor_deployment VALUES ($1,$2,$3,$4,$5,$6,$7,$8)',[plan.deploymentId,plan.epoch,plan.targetId,plan.contextId,fake.origin,plan.continuity,plan.build,plan.capability])
    await transaction(db.pool,client => retainOriginalSource(client,plan))
    await mkdir(join(root,'witnesses'),{ mode: 0o700 })
    await durableExclusive(join(root,'activation.json'),canonical({ enabled: true,deploymentId: plan.deploymentId,epoch: plan.epoch,targetId: plan.targetId,contextId: plan.contextId,origin: fake.origin,continuity: plan.continuity,build: plan.build,capability: plan.capability }))
    const profile: TargetProfile = { kind: 'owned-disposable',targetId: plan.targetId,contextId: plan.contextId,origin: fake.origin,protectedOrigins: ['https://protected.invalid'],credential: 'owned-fake-token' }
    const gate = new ExternalGate(root)
    function reservation(selected = plan): Reservation { return { approvalId: randomUUID(),preparationId: randomUUID(),runId: randomUUID(),commandId: randomUUID(),actorId: authority.actor,...encodePlan(selected) } }
    async function reserve(input = reservation()) { return { input,...await transaction(db.pool,client => reserveApprovedStock(client,input)) } }
    async function apply(runId: string, checkpoint?: ApplyDependencies['checkpoint'], recoveryIds: string[] = [], stopped = () => false) {
      const claim = await gate.claim(), writer = new WriterConnection(db.url)
      try {
        await writer.acquire(plan.deploymentId)
        return await executeRun({ pool: db.pool,writer,gate,claimToken: claim.token,profile,stopped,checkpoint },runId,recoveryIds)
      } finally { await writer.close(); await claim.releaseAfterReap() }
    }
    return { db,root,get fake() { return fake! },authority,plan,profile,gate,reservation,reserve,apply,
      async restartFake() { const port = fake!.port; await fake!.close(); fake = await inventoryFake(db.pool,port) },
      async dispose() { await fake!.close(); await db.dispose(); await rm(root,{ recursive: true,force: true }) } }
  } catch (error) { await fake?.close(); await db.dispose(); await rm(root,{ recursive: true,force: true }); throw error }
}
