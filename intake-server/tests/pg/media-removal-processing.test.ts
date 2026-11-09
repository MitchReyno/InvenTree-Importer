import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createHash, randomUUID } from 'node:crypto'
import { mkdtemp, realpath, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { formedBatch } from '../support/lot-pipeline.ts'
import { processingFixture } from '../support/processing.ts'
import { leadSession, lotSession, seedPhoto } from '../support/sessions.ts'
import { mediaEditor, photoBytes } from '../support/media-removal.ts'
import { transaction } from '#/db/database.ts'
import { grantMedia } from '#/media/grants.ts'
import { BlobStore } from '#/media/blob-store.ts'
import { readMediaStoreIdentity } from '#/media/store-identity.ts'
import { resolveMediaInputs } from '#/media/inputs.ts'
import { leadBatchView } from '#/capture/evidence-observations.ts'
import { issueSessionCapability } from '#/agents/tools/capability.ts'
import { sessionTools } from '#/agents/tools/handlers.ts'
import { runSessionTurn } from '#/agents/session/session-runner.ts'
import { triggerExamine } from '#/processing/examine-trigger.ts'
import { requireUploadCapacity } from '#/media/commands.ts'
import { mediaContent } from '#/media/content.ts'
import { CaptureError } from '#/capture/model.ts'
import { validate } from '@invimport/contracts'

const sha = (bytes: Buffer | string) => createHash('sha256').update(bytes).digest('hex')

interface Job {
  id: string
  stage: string
  subject_id: string | null
  proposals: {
    id: string
    value: { subject_id: string; summary: string }
    currentness?: { state: string; reason?: string }
  }[]
}

async function inboxKeys(pool: import('pg').Pool, lineage: string) {
  const rows = await pool.query<{ kind: string; idempotency_key: string; payload: object }>(
    'SELECT kind,idempotency_key,payload FROM agent_session_inbox WHERE session_lineage_id=$1 ORDER BY seq',
    [lineage],
  )
  return rows.rows
}

test('removing a photo stales what relied on its observations, tells the sessions, and a restore is new evidence', async (t) => {
  const formed = await formedBatch(t)
  const { fixture, batchId } = formed
  await grantMedia(fixture.db.pool, fixture.api.name, 'api')
  const led = await formed.lot('led 0603 red')
  const [images, research] = await formed.successors(led.id)
  for (const row of [images, research]) {
    assert.ok(
      ['finished', 'waiting_input'].includes(
        await runSessionTurn(formed.deps, row.attempt_id, new AbortController().signal),
      ),
    )
  }
  const tray = (
    await fixture.db.pool.query<{ id: string; version: string }>(
      `SELECT e.id, v.id AS version FROM media_evidence e JOIN media_version v ON v.evidence_id=e.id
       WHERE e.batch_id=$1 AND e.label='Tray'`,
      [batchId],
    )
  ).rows[0]
  const frozen = (await formed.successors(led.id)).find((row) => row.stage === 'research')!
  const before = await formed.read()
  assert.ok(before.evidence_observations?.length)

  const media = mediaEditor(fixture.api.pool, fixture.config, batchId)
  const removed = await media.applied({ kind: 'remove', evidence_ids: [tray.id] })

  const jobs = ((await fixture.http(`/batches/${batchId}/processing`)).value as { jobs: Job[] })
    .jobs
  const lead = jobs.find((job) => job.stage === 'examine')!
  const identities = lead.proposals.filter((p) => p.value.summary.startsWith('Identity'))
  assert.ok(identities.length >= 2)
  for (const proposal of identities) {
    // Through the second join: they cite observations on the photo, not the photo itself.
    assert.deepEqual(proposal.currentness, { state: 'stale', reason: 'evidence_removed' })
  }
  const researchJob = jobs.find((job) => job.id === research.job_id)!
  assert.ok(researchJob.proposals.length)
  for (const proposal of researchJob.proposals) {
    // Downstream of the identity: stale through the cascade, for the same reason.
    assert.deepEqual(proposal.currentness, { state: 'stale', reason: 'evidence_removed' })
  }

  // The lead gets a batch notice; the lot's Research and Images a notice each.
  const noticeKey = (lineage: string) => `evidence_removed:${removed.revision}:${lineage}`
  for (const lineage of [formed.leadJob, research.job_id, images.job_id]) {
    const items = await inboxKeys(fixture.db.pool, lineage)
    assert.ok(
      items.some((item) => item.kind === 'revision' && item.idempotency_key === noticeKey(lineage)),
      lineage,
    )
  }

  // Review, the lead's batch view and new inputs leave it out; frozen inputs keep it.
  const after = await formed.read()
  assert.equal(after.evidence_observations, undefined)
  assert.ok(after.lots.every((lot) => !lot.evidence_observation_ids))
  const view = await transaction(fixture.writer.pool, (client) => leadBatchView(client, batchId))
  assert.deepEqual(view.observations, [])
  assert.ok(view.lots.every((lot) => lot.observation_ids.length === 0))
  const inputs = await transaction(fixture.api.pool, (client) =>
    resolveMediaInputs(client, fixture.config, batchId, [led.id]),
  )
  assert.deepEqual(inputs.versions, [])
  assert.equal(inputs.context, undefined, 'its evidence note leaves new inputs too')
  const unchanged = (await formed.successors(led.id)).find((row) => row.stage === 'research')!
  assert.ok(unchanged.input_bytes.equals(frozen.input_bytes))
  assert.ok(unchanged.input_bytes.toString('utf8').includes(tray.version))

  // An operator observation on the removed photo is refused.
  const observed = await fixture.http(`/batches/${batchId}/edits`, {
    expected_revision: after.revision,
    change: {
      kind: 'observation',
      evidence_version_id: tray.version,
      region: {
        kind: 'pixels',
        x: 0,
        y: 0,
        width: 8,
        height: 8,
        source_width: 768,
        source_height: 512,
      },
    },
  })
  assert.equal(observed.status, 409, JSON.stringify(observed.value))
  assert.equal(observed.value.code, 'media_evidence_removed')

  // A restore reaches the lead as new evidence; the stale proposals stay stale.
  const restored = await media.applied({ kind: 'restore', evidence_ids: [tray.id] })
  const leadItems = await inboxKeys(fixture.db.pool, formed.leadJob)
  assert.ok(
    leadItems.some(
      (item) =>
        item.kind === 'evidence' &&
        item.idempotency_key === `restored:${tray.id}:${restored.revision}` &&
        (item.payload as { version_id?: string }).version_id === tray.version,
    ),
  )
  const stillStale = (
    (await fixture.http(`/batches/${batchId}/processing`)).value as { jobs: Job[] }
  ).jobs.find((job) => job.id === research.job_id)!
  assert.ok(stillStale.proposals.every((p) => p.currentness?.state === 'stale'))
  assert.ok((await formed.read()).evidence_observations?.length, 'observations come back')

  // A second removal is told again, under its own revision.
  const again = await media.applied({ kind: 'remove', evidence_ids: [tray.id] })
  const researchItems = await inboxKeys(fixture.db.pool, research.job_id)
  assert.deepEqual(
    researchItems
      .filter((item) => item.idempotency_key.startsWith('evidence_removed:'))
      .map((item) => item.idempotency_key),
    [noticeKey(research.job_id), `evidence_removed:${again.revision}:${research.job_id}`],
  )
})

test('each of the three joins stales a proposal, and publication refuses removed sources even after delivery', async (t) => {
  const fixture = await processingFixture()
  const root = await realpath(await mkdtemp(join(tmpdir(), 'removal-sources-')))
  t.after(async () => {
    await fixture.dispose()
    await rm(root, { recursive: true, force: true })
  })
  await grantMedia(fixture.db.pool, fixture.api.name, 'api')
  const capture = await fixture.seedCapture()
  const batchId = capture.batch.id
  const store = await BlobStore.initialize(
    join(root, 'blobs'),
    await readMediaStoreIdentity(fixture.db.pool),
  )
  const content = await photoBytes(5)
  const kept = await photoBytes(6)
  await transaction(fixture.db.pool, async (client) => {
    for (const bytes of [content.original, content.preview, kept.original, kept.preview]) {
      await store.publish(client, bytes)
    }
  })
  const photo = await seedPhoto(fixture, batchId, { width: 32, height: 24 }, 'Reel', 0, content)
  const other = await seedPhoto(fixture, batchId, { width: 32, height: 24 }, 'Box', 0, kept)
  const noteId = randomUUID()
  const observationId = randomUUID()
  await transaction(fixture.db.pool, async (client) => {
    for (const evidence of [photo.evidence, other.evidence]) {
      await client.query(
        'INSERT INTO media_subject_link(id,batch_id,evidence_id,subject_id,linked,revision,actor_id) VALUES($1,$2,$3,$4,true,1,$5)',
        [randomUUID(), batchId, evidence, capture.packetA.id, fixture.identity.actor],
      )
    }
    await client.query(
      'INSERT INTO media_evidence_note(id,batch_id,evidence_id,revision,text,actor_id) VALUES($1,$2,$3,1,$4,$5)',
      [noteId, batchId, photo.evidence, 'Reel label reads 0603', fixture.identity.actor],
    )
    await client.query(
      `INSERT INTO capture_evidence_observation(id,batch_id,evidence_version_id,page,region,readings,origin,operator_edited,revision)
       VALUES($1,$2,$3,1,$4,$5,'operator',true,1)`,
      [
        observationId,
        batchId,
        photo.version,
        { kind: 'pixels', x: 0, y: 0, width: 8, height: 8, source_width: 32, source_height: 24 },
        { markings: ['0603'] },
      ],
    )
    await client.query(
      "INSERT INTO capture_lot_evidence_observation(lot_id,evidence_observation_id,batch_id,status,revision) VALUES($1,$2,$3,'active',1)",
      [capture.packetA.id, observationId, batchId],
    )
  })

  const session = await lotSession(fixture, capture, capture.packetA)
  const lead = await leadSession(fixture, capture)
  const context = {
    pool: fixture.runner.pool,
    writerPool: fixture.writer.pool,
    config: fixture.config,
    store,
    statusIntervalMs: 0,
    imageBudget: new Map<string, number>(),
    deliveredMedia: new Map<string, Set<string>>(),
    cropCacheDir: join(root, 'crops'),
  }
  const tools = sessionTools(context)
  const token = await transaction(fixture.runner.pool, (client) =>
    issueSessionCapability(client, session.attempt),
  )
  const leadToken = await transaction(fixture.runner.pool, (client) =>
    issueSessionCapability(client, lead.attempt),
  )
  for (const version of [photo, other]) {
    const fetched = await tools.fetch_evidence(token, {
      evidence_id: version.evidence,
      version_id: version.version,
    })
    assert.ok(fetched.result.ok, JSON.stringify(fetched.result))
  }
  const mediaSource = {
    kind: 'media_version' as const,
    evidence_id: photo.evidence,
    version_id: photo.version,
    sha256: sha(content.original),
  }
  const otherSource = {
    kind: 'media_version' as const,
    evidence_id: other.evidence,
    version_id: other.version,
    sha256: sha(kept.original),
  }
  const noteSource = {
    kind: 'note' as const,
    note_id: noteId,
    text_sha256: sha('Reel label reads 0603'),
  }
  const observationSource = {
    kind: 'evidence_observation' as const,
    evidence_observation_id: observationId,
    revision: '1',
  }
  const propose = async (summary: string, cited: object[], reliesOn: object[] = cited) =>
    tools.propose(token, {
      proposal: {
        schema_version: 'bench-intake-proposal/5',
        subject_id: capture.packetA.id,
        summary,
        sources: cited,
        relies_on: { fields: ['research'], sources: reliesOn },
      },
    })
  const published: Record<string, string> = {}
  for (const [name, cited, reliesOn] of [
    ['version', [mediaSource], [mediaSource]],
    ['note', [noteSource], [noteSource]],
    ['observation', [otherSource], [observationSource]],
    ['unrelated', [otherSource], [otherSource]],
  ] as const) {
    const result = await propose(name, [...cited], [...reliesOn])
    assert.ok(result.result.ok, `${name}: ${JSON.stringify(result.result)}`)
    published[name] = (result.result as { id: string }).id
  }
  const downstream = await propose(
    'downstream',
    [otherSource],
    [otherSource, { kind: 'proposal', proposal_id: published.version }],
  )
  assert.ok(downstream.result.ok, JSON.stringify(downstream.result))
  published.downstream = (downstream.result as { id: string }).id

  const media = mediaEditor(fixture.api.pool, fixture.config, batchId)
  await media.applied({ kind: 'remove', evidence_ids: [photo.evidence] })

  const stale = await fixture.db.pool.query<{ proposal_id: string; reason: string }>(
    'SELECT proposal_id,reason FROM processing_proposal_stale',
  )
  const reasons = new Map(stale.rows.map((row) => [row.proposal_id, row.reason]))
  for (const name of ['version', 'note', 'observation', 'downstream']) {
    assert.equal(reasons.get(published[name]), 'evidence_removed', name)
  }
  assert.equal(reasons.has(published.unrelated), false)

  // Delivered before the delete, but publication still refuses every removed source.
  for (const [name, cited, reliesOn] of [
    ['version', [mediaSource], [mediaSource]],
    ['note', [noteSource], [noteSource]],
    ['observation', [otherSource], [observationSource]],
  ] as const) {
    const result = await propose(`again ${name}`, [...cited], [...reliesOn])
    assert.deepEqual(
      [result.result.ok, !result.result.ok && result.result.error],
      [false, 'media_evidence_removed'],
      name,
    )
  }
  // Agent reads refuse it as well: the lot's fetch, the lead's preview and an observation.
  const fetched = await tools.fetch_evidence(token, {
    evidence_id: photo.evidence,
    version_id: photo.version,
  })
  assert.deepEqual(
    [fetched.result.ok, !fetched.result.ok && fetched.result.error, fetched.images],
    [false, 'media_evidence_removed', undefined],
  )
  const leadFetch = await tools.fetch_evidence(leadToken, {
    evidence_id: photo.evidence,
    version_id: photo.version,
  })
  assert.deepEqual(
    [leadFetch.result.ok, !leadFetch.result.ok && leadFetch.result.error],
    [false, 'media_evidence_removed'],
  )
  const batch = (await fixture.http(`/batches/${batchId}`)).value as { revision: string }
  const recorded = await tools.record_observation(leadToken, {
    base_revision: batch.revision,
    evidence_version_id: photo.version,
    region: {
      kind: 'pixels',
      x: 0,
      y: 0,
      width: 8,
      height: 8,
      source_width: 32,
      source_height: 24,
    },
    readings: { markings: ['0603'] },
  })
  assert.deepEqual(
    [recorded.result.ok, !recorded.result.ok && recorded.result.error],
    [false, 'media_evidence_removed'],
  )
  // The operator's region crop of an observation on it is refused too.
  await assert.rejects(
    mediaContent(fixture.api.pool, fixture.config, store).observationCrop(
      batchId,
      observationId,
      join(root, 'operator-crops'),
    ),
    (error: unknown) => error instanceof CaptureError && error.code === 'media_evidence_removed',
  )
  const linked = await fixture.db.pool.query(
    'SELECT 1 FROM capture_evidence_observation WHERE evidence_version_id=$1',
    [photo.version],
  )
  assert.equal(linked.rowCount, 1, 'no observation was added on the removed photo')
})

test('the Examine trigger skips a removed photo, and a restored one wakes it', async (t) => {
  const fixture = await processingFixture({ profileId: 'synthetic-session/1' })
  t.after(() => fixture.dispose())
  await grantMedia(fixture.db.pool, fixture.api.name, 'api')
  const capture = await fixture.seedCapture()
  const photo = await seedPhoto(fixture, capture.batch.id, { width: 32, height: 24 }, 'Reel', 60)
  const media = mediaEditor(fixture.api.pool, fixture.config, capture.batch.id)
  await media.applied({ kind: 'remove', evidence_ids: [photo.evidence] })
  const swept = await triggerExamine(fixture.writer.pool, fixture.config, { quietMs: 0 })
  assert.deepEqual(swept.created, [], 'removed evidence never wakes the lead')
  await media.applied({ kind: 'restore', evidence_ids: [photo.evidence] })
  const woken = await triggerExamine(fixture.writer.pool, fixture.config, { quietMs: 0 })
  assert.equal(woken.created.length, 1)
})

test('a full batch with removed items still validates, and removed items keep counting', async (t) => {
  const fixture = await processingFixture()
  t.after(() => fixture.dispose())
  await grantMedia(fixture.db.pool, fixture.api.name, 'api')
  const capture = await fixture.seedCapture()
  const evidence: string[] = []
  await transaction(fixture.db.pool, async (client) => {
    await client.query('INSERT INTO media_batch(batch_id) VALUES($1)', [capture.batch.id])
    for (let index = 0; index < 200; index += 1) {
      const id = randomUUID()
      evidence.push(id)
      await client.query(
        'INSERT INTO media_evidence(id,batch_id,label,actor_id) VALUES($1,$2,$3,$4)',
        [id, capture.batch.id, `Photo ${index}`, fixture.identity.actor],
      )
    }
  })
  const media = mediaEditor(fixture.api.pool, fixture.config, capture.batch.id)
  const removed = await media.applied({ kind: 'remove', evidence_ids: evidence.slice(0, 120) })
  validate('MediaSnapshot', removed)
  assert.equal(removed.evidence.length, 80)
  assert.equal(removed.removed?.length, 120)
  await assert.rejects(
    transaction(fixture.api.pool, (client) => requireUploadCapacity(client, capture.batch.id)),
    (error: unknown) => error instanceof CaptureError && error.code === 'media_capacity',
  )
})
