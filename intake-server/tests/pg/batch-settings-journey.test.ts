import { test } from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import type { CaptureSnapshotDto, ManualPreviewDto, ManualRunDto } from '@invimport/contracts'
import { strictJson } from '@invimport/contracts/json'
import { manualFixture } from '../support/manual.ts'
import { executeManualDispatch } from '#/review/runner.ts'
import { acceptEnvelope, claimProcessingCommand } from '#/processing/runner.ts'
import { mediaRepository } from '#/media/repository.ts'
import { editMedia } from '#/media/edit.ts'
import { processMediaCommand } from '#/media/worker.ts'

const png = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAIAAAABCAIAAAB7QOjdAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAAD0lEQVQImWP4ICLHdUIDAAhZAh0cg3OhAAAAAElFTkSuQmCC',
  'base64',
)

test(
  'one connected journey: autosave conflict and reconnect, location resolution, estimate review and supervised record creation',
  { timeout: 180000 },
  async (context) => {
    const image = process.env.INTAKE_MEDIA_DECODER_IMAGE
    if (!image) {
      context.skip('explicit isolated decoder image required')
      return
    }
    const fixture = await manualFixture({ records: true, media: true, processing: true })
    try {
      const capture = await fixture.seedCapture()
      const batchId = capture.batch.id
      const read = async () =>
        (await fixture.http(`/batches/${batchId}`)).value as CaptureSnapshotDto

      // 1. Autosave against a stale revision is refused; a fresh read then saves the drafts.
      const stale = capture.batch.revision
      await capture.edit({ kind: 'lot', id: capture.a.id, quantity: { mode: 'unset' } })
      const parent = capture.batch.observations.find(
        (item) => item.model === 'location' && item.pk === '43',
      )!
      const locationDraft = randomUUID()
      const companyDraft = randomUUID()
      const settings = (current: CaptureSnapshotDto) => ({
        kind: 'batch_settings',
        title: current.title,
        default_location: { mode: 'draft', draft_id: locationDraft },
        intent: {
          supplier: { absent: false, selection: { mode: 'draft', draft_id: companyDraft } },
          order: { reference: { mode: 'auto' }, purchase_date: { mode: 'auto' } },
          shared_tags: { manual: [], auto: false },
        },
        notes: { batch: null, order: null },
        drafts: [
          {
            draft_id: locationDraft,
            kind: 'location',
            value: {
              name: 'Reel shelf',
              description: 'Opened reels',
              parent: {
                observation_id: parent.id,
                target_context_id: parent.target_context_id,
                model: 'location',
                pk: '43',
              },
            },
          },
          {
            draft_id: companyDraft,
            kind: 'company',
            value: { name: 'Acme Reels', description: '', also_manufacturer: true, logo: null },
          },
        ],
      })
      const conflict = await fixture.http(`/batches/${batchId}/edits`, {
        expected_revision: stale,
        change: settings(capture.batch),
      })
      assert.ok(conflict.status >= 400 && conflict.status < 500, JSON.stringify(conflict.value))
      assert.equal((await read()).settings_intent, undefined, 'a refused save writes nothing')
      const reconnected = await read()
      const saved = await fixture.http(`/batches/${batchId}/edits`, {
        expected_revision: reconnected.revision,
        change: settings(reconnected),
      })
      assert.equal(saved.status, 200, JSON.stringify(saved.value))
      let batch = saved.value as CaptureSnapshotDto
      assert.equal(batch.settings_intent?.default_location_draft, locationDraft)
      assert.equal((await fixture.fake.records()).filter((v) => v.method === 'POST').length, 0)

      // 2. Location resolution: Packet A uses the unset batch default's draft; B keeps its own.
      assert.equal(batch.defaults.location.mode, 'unset')
      assert.equal(batch.lots.find((lot) => lot.id === capture.b.id)?.location.mode, 'set')

      // 3. Estimate review: a Processing estimate is retained and accepted only by a human edit.
      const repository = mediaRepository(fixture.api.pool, fixture.config, fixture.store!)
      const uploaded = (await repository.upload(batchId, randomUUID(), '1', 'label.png', png)) as {
        evidence_id: string
        version: { id: string; digest: string }
      }
      await processMediaCommand(fixture.db.pool, fixture.store!, fixture.config, image)
      await editMedia(fixture.api.pool, fixture.config, batchId, randomUUID(), {
        expected_revision: (await repository.snapshot(batchId)).revision,
        change: {
          kind: 'link',
          evidence_id: uploaded.evidence_id,
          subject_id: capture.a.id,
          linked: true,
        },
      })
      batch = await read()
      const started = await fixture.http(`/batches/${batchId}/processing`, {
        schema_version: 'bench-intake-processing/1',
        expected_capture_revision: batch.revision,
        subject_ids: [capture.a.id],
        stages: ['reading'],
      })
      assert.equal(started.status, 202, JSON.stringify(started.value))
      const command = (
        await fixture.db.pool.query(
          `SELECT command.workflow_id, command.payload_bytes FROM command
           JOIN processing_attempt attempt ON attempt.command_id = command.id WHERE attempt.id = $1`,
          [started.value.attempt_ids[0]],
        )
      ).rows[0]
      const claimed = await claimProcessingCommand(
        fixture.processingRunner!.pool,
        fixture.config as never,
        command.workflow_id,
        strictJson(command.payload_bytes.toString('utf8')),
        'processing/2',
      )
      assert.ok(claimed)
      const binding = {
        schema_version: 'bench-intake-runner/2',
        profile_id: 'synthetic-research/2',
        handler_version: 'processing/2',
        job_id: claimed.payload.job_id,
        attempt_id: claimed.payload.attempt_id,
        command_id: claimed.payload.command_id,
        input_sha256: claimed.payload.input_sha256,
      } as const
      const version = (await repository.snapshot(batchId)).evidence
        .find((item) => item.id === uploaded.evidence_id)!
        .versions.find((item) => item.kind === 'original')!
      const accept = (envelope: unknown) =>
        acceptEnvelope(
          fixture.processingRunner!.pool,
          fixture.config as never,
          claimed.channelToken,
          envelope as never,
        )
      assert.equal(
        await accept({
          ...binding,
          sequence: '1',
          kind: 'proposal',
          payload: {
            schema_version: 'bench-intake-proposal/4',
            subject_id: capture.a.id,
            summary: 'Deterministic fixture estimate from the label photo; not model reasoning.',
            sources: [
              {
                kind: 'media_version',
                evidence_id: uploaded.evidence_id,
                version_id: version.id,
                sha256: version.digest,
              },
            ],
            quantity: { value: '17', status: 'estimated' },
          },
        }),
        'accepted',
      )
      await accept({ ...binding, sequence: '2', kind: 'terminal', payload: { state: 'ready' } })
      const processing = (await fixture.http(`/batches/${batchId}/processing`)).value
      const job = processing.jobs.find(
        (value: { attempt_id: string }) => value.attempt_id === claimed.payload.attempt_id,
      )
      assert.equal(job.state, 'ready')
      assert.deepEqual(job.proposals[0].value.quantity, { value: '17', status: 'estimated' })
      assert.equal(
        (await read()).lots.find((lot) => lot.id === capture.a.id)?.quantity.mode,
        'unset',
        'an estimate never becomes a count by itself',
      )
      // The explicit human acceptance Review issues for the estimate.
      const counted = await fixture.http(`/batches/${batchId}/edits`, {
        expected_revision: (await read()).revision,
        change: { kind: 'lot', id: capture.a.id, quantity: { mode: 'set', value: '17' } },
      })
      assert.equal(counted.status, 200, JSON.stringify(counted.value))

      // 4. Review, prepare, approve and run; then read the created records back from the target.
      batch = await read()
      const scope = { expected_batch_revision: batch.revision, selected_lot_ids: [capture.a.id] }
      assert.equal((await fixture.http(`/batches/${batchId}/reviews`, scope)).status, 200)
      const prepared = await fixture.http(`/batches/${batchId}/preparations`, scope)
      assert.equal(prepared.value.status, 'prepared', JSON.stringify(prepared.value))
      const preview = prepared.value.preparation as ManualPreviewDto
      assert.equal(preview.effects[0].quantity, '17')
      assert.deepEqual(
        preview.supported_effects?.map((effect) => effect.kind),
        ['create_location', 'create_company'],
      )
      const approved = await fixture.http(
        `/preparations/${preview.id}/approvals`,
        {
          preparation_id: preview.id,
          expected_plan_sha256: preview.plan_sha256,
          expected_review_fingerprint: preview.review_fingerprint,
          selected_lot_ids: preview.selected_lot_ids,
          expected_target_revision: preview.target_revision,
        },
        randomUUID(),
      )
      assert.equal(approved.status, 200, JSON.stringify(approved.value))
      const runId = approved.value.run_id as string
      const before = (await fixture.http(`/runs/${runId}`)).value as ManualRunDto
      await fixture.http(`/runs/${runId}/start`, { expected_run_revision: before.revision })
      const dispatch = (
        await fixture.db.pool.query(
          'SELECT c.workflow_id,c.payload_bytes FROM manual_dispatch d JOIN command c ON c.id=d.command_id WHERE d.run_id=$1 ORDER BY d.sequence DESC LIMIT 1',
          [runId],
        )
      ).rows[0]
      const outcome = await executeManualDispatch(
        fixture.runner.pool,
        fixture.runnerConfig,
        dispatch.workflow_id,
        JSON.parse(dispatch.payload_bytes.toString('utf8')),
      )
      assert.equal(outcome.state, 'settled_complete')
      const run = (await fixture.http(`/runs/${runId}`)).value as ManualRunDto
      const created = (kind: string) =>
        run.supported_effects!.find((effect) => effect.kind === kind)!.remote_pks[0]
      const location = await fetch(
        `${fixture.fake.origin}/api/stock/location/${created('create_location')}/`,
        {
          headers: { authorization: 'Token owned-fake-token' },
        },
      )
      assert.deepEqual(await location.json(), {
        pk: created('create_location'),
        name: 'Reel shelf',
        description: 'Opened reels',
        parent: '43',
      })
      const company = await fetch(
        `${fixture.fake.origin}/api/company/${created('create_company')}/`,
        {
          headers: { authorization: 'Token owned-fake-token' },
        },
      )
      assert.deepEqual(await company.json(), {
        pk: created('create_company'),
        name: 'Acme Reels',
        description: '',
        is_supplier: true,
        is_manufacturer: true,
      })
      const stock = await fetch(`${fixture.fake.origin}/api/stock/${run.confirmed_stock_ids[0]}/`, {
        headers: { authorization: 'Token owned-fake-token' },
      })
      const stored = await stock.json()
      assert.equal(stored.location, created('create_location'))
      assert.equal(stored.quantity, '17')
    } finally {
      await fixture.dispose()
    }
  },
)
