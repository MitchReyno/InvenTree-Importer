import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { CaptureSnapshotDto } from '@invimport/contracts'
import { processingFixture } from './processing.ts'
import { seedPhoto } from './sessions.ts'
import { triggerExamine } from '../../src/processing/examine-trigger.ts'
import { decodeSessionInput } from '../../src/processing/session-input.ts'
import { saveAgentSettings } from '../../src/agents/settings.ts'
import { startSessionToolServer } from '../../src/agents/tools/server.ts'
import { runSessionTurn, syntheticSessionDriver } from '../../src/agents/session/session-runner.ts'

export type Fixture = Awaited<ReturnType<typeof processingFixture>>

export async function photoWithNote(
  fixture: Fixture,
  batchId: string,
  label: string,
  note: string,
) {
  const photo = await seedPhoto(fixture, batchId, { width: 768, height: 512 }, label)
  await fixture.db.pool.query(
    'INSERT INTO media_evidence_note(id,batch_id,evidence_id,revision,text,actor_id) VALUES($1,$2,$3,1,$4,$5)',
    [randomUUID(), batchId, photo.evidence, note, fixture.identity.actor],
  )
  return photo
}

export interface Successor {
  job_id: string
  stage: string
  job_state: string
  attempt_id: string
  attempt_state: string
  input_bytes: Buffer
  input_digest: Buffer
}

/** A batch whose lead session has formed lots, with the tool server and runner wired up. */
export async function formedBatch(t: { after: (fn: () => Promise<void>) => void }) {
  const fixture = await processingFixture({ profileId: 'synthetic-session/1' })
  const stateRoot = await mkdtemp(join(tmpdir(), 'stable-identity-'))
  const server = await startSessionToolServer({
    pool: fixture.runner.pool,
    writerPool: fixture.writer.pool,
    config: fixture.config,
    statusIntervalMs: 0,
  })
  t.after(async () => {
    await server.close()
    await fixture.dispose()
    await rm(stateRoot, { recursive: true, force: true })
  })
  const deps = {
    pool: fixture.runner.pool,
    config: fixture.config,
    host: { codexExecutable: 'unused', claudeExecutable: 'unused', stateRoot, env: {} },
    toolUrl: server.url,
    drivers: { 'synthetic-session/1': syntheticSessionDriver },
  }
  // Room for the lead session and both lots' successors at once; queue order is tested elsewhere.
  const settings = await fixture.http('/agent-settings')
  await saveAgentSettings(fixture.api.pool, fixture.config, {
    expected_revision: (settings.value as { revision: string }).revision,
    selection: { provider: 'claude', authentication: 'api_key', model: 'claude-sonnet-5-5' },
    session_concurrency: 8,
  })
  const capture = await fixture.seedCapture()
  const batchId = capture.batch.id
  await photoWithNote(fixture, batchId, 'Tray', '16 MHz crystal; LED 0603 red ×500')
  await triggerExamine(fixture.writer.pool, fixture.config, { quietMs: 0 })
  const lead = await fixture.db.pool.query<{ id: string; current_attempt_id: string }>(
    "SELECT id,current_attempt_id FROM processing_job WHERE batch_id=$1 AND stage='examine'",
    [batchId],
  )
  const leadAttempt = lead.rows[0].current_attempt_id
  assert.equal(await runSessionTurn(deps, leadAttempt, new AbortController().signal), 'finished')
  const read = async () => (await fixture.http(`/batches/${batchId}`)).value as CaptureSnapshotDto
  const lot = async (label: string) => (await read()).lots.find((item) => item.label === label)!
  const successors = async (lotId: string) =>
    (
      await fixture.db.pool.query<Successor>(
        `SELECT j.id AS job_id,j.stage,j.state AS job_state,a.id AS attempt_id,a.state AS attempt_state,
           i.manifest_bytes AS input_bytes,i.manifest_digest AS input_digest
         FROM processing_job j JOIN processing_attempt a ON a.id=j.current_attempt_id
         JOIN processing_input i ON i.id=a.input_id
         WHERE j.subject_id=$1 AND j.stage IN ('research','images') ORDER BY j.stage`,
        [lotId],
      )
    ).rows
  const identities = async (lotId: string) =>
    (
      await fixture.db.pool.query<{ id: string; stale: string | null }>(
        `SELECT p.id,s.reason AS stale FROM processing_proposal p
         JOIN processing_attempt a ON a.id=p.attempt_id JOIN processing_job j ON j.id=a.job_id
         JOIN processing_message m ON m.id=p.message_id
         LEFT JOIN processing_proposal_stale s ON s.proposal_id=p.id
         WHERE j.stage='examine' AND p.relies_on->'fields' ? 'identity'
           AND p.relies_on->'sources' @> jsonb_build_array(jsonb_build_object('kind','observation_set','lot_id',$1::text))
         ORDER BY m.sequence,p.id`,
        [lotId],
      )
    ).rows
  const pinned = (row: Successor) =>
    decodeSessionInput(row.input_bytes, row.input_digest).pinned_proposal_ids
  return {
    fixture,
    deps,
    batchId,
    leadJob: lead.rows[0].id,
    leadAttempt,
    read,
    lot,
    successors,
    identities,
    pinned,
  }
}
