import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { mkdtemp, realpath, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { CaptureSnapshotDto } from '@invimport/contracts'
import { processingFixture } from './processing.ts'
import { seedPhoto } from './sessions.ts'
import { triggerExamine } from '#/processing/examine-trigger.ts'
import { decodeSessionInput } from '#/processing/session-input.ts'
import { singleProvider } from './agent-settings.ts'
import { saveAgentSettings } from '#/agents/settings.ts'
import { startSessionToolServer } from '#/agents/tools/server.ts'
import { runSessionTurn, syntheticSessionDriver } from '#/agents/session/session-runner.ts'
import sharp from 'sharp'
import { BlobStore } from '#/media/blob-store.ts'
import { readMediaStoreIdentity } from '#/media/store-identity.ts'
import { transaction } from '#/db/database.ts'

export type Fixture = Awaited<ReturnType<typeof processingFixture>>

/** A plain 768×512 photo whose image the session can be given, published to the store. */
async function storedPhoto(fixture: Fixture, store: BlobStore) {
  const bytes = await sharp({
    create: { width: 768, height: 512, channels: 3, background: { r: 40, g: 90, b: 160 } },
  })
    .png()
    .toBuffer()
  await transaction(fixture.db.pool, (client) => store.publish(client, bytes))
  return { original: bytes, preview: bytes }
}

export async function photoWithNote(
  fixture: Fixture,
  batchId: string,
  label: string,
  note: string,
  /** With a store, the photo has real bytes, so a fetch gives the session its image. */
  store?: BlobStore,
) {
  const content = store ? await storedPhoto(fixture, store) : undefined
  const photo = await seedPhoto(fixture, batchId, { width: 768, height: 512 }, label, 0, content)
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

/**
 * A batch whose lead session has formed lots, with the tool server and runner wired up. With
 * `stageInputs`, the test-only switch is on from the start, so the lead and its successors seal
 * `/7`. With `images`, the photo has real bytes in a blob store the tool server reads, so a
 * fetch gives the session its image.
 */
export async function formedBatch(
  t: { after: (fn: () => Promise<void>) => void },
  { stageInputs = false, images = false }: { stageInputs?: boolean; images?: boolean } = {},
) {
  const fixture = await processingFixture({ profileId: 'synthetic-session/1' })
  if (stageInputs) {
    fixture.config.stageInputs = 'local'
  }
  const stateRoot = await realpath(await mkdtemp(join(tmpdir(), 'stable-identity-')))
  const store = images
    ? await BlobStore.initialize(
        join(stateRoot, 'blobs'),
        await readMediaStoreIdentity(fixture.db.pool),
      )
    : undefined
  const serverOptions = {
    pool: fixture.runner.pool,
    writerPool: fixture.writer.pool,
    config: fixture.config,
    store,
    statusIntervalMs: 0,
  }
  const server = await startSessionToolServer(serverOptions)
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
  await saveAgentSettings(
    fixture.api.pool,
    fixture.config,
    singleProvider({
      expected_revision: (settings.value as { revision: string }).revision,
      selection: { provider: 'claude', authentication: 'api_key', model: 'claude-sonnet-5-5' },
      session_concurrency: 8,
    }),
  )
  const capture = await fixture.seedCapture()
  const batchId = capture.batch.id
  await photoWithNote(fixture, batchId, 'Tray', '16 MHz crystal; LED 0603 red ×500', store)
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
    server,
    serverOptions,
    store,
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
