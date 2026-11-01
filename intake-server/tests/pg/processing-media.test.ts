import { test } from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import type { ProcessingEnvelopeV2Dto } from '@invimport/contracts'
import { strictJson } from '@invimport/contracts/json'
import { processingFixture } from '../support/processing.ts'
import { processingMediaFixture } from '../support/processing-media.ts'
import { acceptEnvelope, claimProcessingCommand } from '../../src/processing/runner.ts'
import { decodeMediaInputs } from '../../src/media/inputs.ts'
import { readCommandMediaInputs } from '../../src/media/command-inputs.ts'
import { transaction } from '../../src/db/database.ts'

async function claim(fixture: Awaited<ReturnType<typeof processingFixture>>, attemptId: string) {
  const commands = await fixture.db.pool.query(
    `SELECT command.workflow_id, command.payload_bytes
     FROM command JOIN processing_attempt attempt ON attempt.command_id = command.id
     WHERE attempt.id = $1`,
    [attemptId],
  )
  const retained = commands.rows[0]
  const command = await claimProcessingCommand(
    fixture.runner.pool,
    fixture.config,
    retained.workflow_id,
    strictJson(retained.payload_bytes.toString('utf8')),
    'processing/2',
  )
  assert.ok(command)
  assert.equal(command.manifest.schema_version, 'bench-intake-input/2')
  if (command.manifest.schema_version !== 'bench-intake-input/2')
    throw new Error('fixture_v2_required')
  return { ...command, manifest: command.manifest }
}

function envelope(
  command: Awaited<ReturnType<typeof claim>>,
  sequence: string,
  content:
    | Pick<Extract<ProcessingEnvelopeV2Dto, { kind: 'proposal' }>, 'kind' | 'payload'>
    | Pick<Extract<ProcessingEnvelopeV2Dto, { kind: 'question' }>, 'kind' | 'payload'>
    | Pick<Extract<ProcessingEnvelopeV2Dto, { kind: 'terminal' }>, 'kind' | 'payload'>,
): ProcessingEnvelopeV2Dto {
  return {
    schema_version: 'bench-intake-runner/2',
    profile_id: 'synthetic-research/2',
    handler_version: 'processing/2',
    job_id: command.payload.job_id,
    attempt_id: command.payload.attempt_id,
    command_id: command.payload.command_id,
    input_sha256: command.payload.input_sha256,
    sequence,
    ...content,
  }
}

test(
  'media-only lot input binds linked-Part versions with disabled web media and retains stale history/occupancy',
  { timeout: 60000 },
  async () => {
    const fixture = await processingFixture()
    let media: Awaited<ReturnType<typeof processingMediaFixture>> | undefined
    try {
      const created = await fixture.http('/batches', {
        title: 'Media-only synthetic metadata',
        note: '',
      })
      assert.equal(created.status, 201)
      let batch = created.value
      async function edit(change: unknown) {
        const result = await fixture.http(`/batches/${batch.id}/edits`, {
          expected_revision: batch.revision,
          change,
        })
        assert.equal(result.status, 200)
        batch = result.value
      }
      await edit({ kind: 'add_part', label: 'Shared Part' })
      const partId = batch.parts[0].id
      await edit({ kind: 'add_lot', label: 'Photo-only A', note: '', part_subject_id: partId })
      await edit({ kind: 'add_lot', label: 'Unrelated B', note: '', part_subject_id: null })
      const lotA = batch.lots.find((lot: { label: string }) => lot.label === 'Photo-only A')
      const lotB = batch.lots.find((lot: { label: string }) => lot.label === 'Unrelated B')
      await edit({ kind: 'lot', id: lotA.id, quantity: { mode: 'set', value: '17.000001' } })
      media = await processingMediaFixture(fixture, batch.id)
      const ready = await media.upload(partId, 'Synthetic retained Part evidence')
      await media.decodeNext()
      assert.equal((await media.snapshot()).evidence[0].versions[0].state, 'ready')
      const bootstrap = await fetch(`${fixture.config.origin}/api/v1/bootstrap`)
      assert.equal((await bootstrap.json()).media_enabled, false)
      const input = {
        schema_version: 'bench-intake-processing/1',
        expected_capture_revision: batch.revision,
        subject_ids: [lotA.id],
        stages: ['reading', 'research'],
      }
      const started = await fixture.http(`/batches/${batch.id}/processing`, input)
      assert.equal(started.status, 202)
      const reading = await claim(fixture, started.value.attempt_ids[0])
      assert.ok(reading.manifest.notes.every((note) => note.text.trim() === ''))
      const staged = decodeMediaInputs(
        Buffer.from(reading.manifest.media.manifest),
        Buffer.from(reading.manifest.media.sha256, 'hex'),
      )
      assert.deepEqual(staged.subjectIds, [lotA.id, partId].sort())
      assert.deepEqual(
        staged.versions.map((version) => [version.evidenceId, version.versionId, version.digest]),
        [[ready.evidence_id, ready.version.id, ready.version.digest]],
      )
      await transaction(fixture.runner.pool, async (client) => {
        const retained = await readCommandMediaInputs(
          client,
          fixture.config,
          batch.id,
          reading.payload.command_id,
        )
        assert.equal(retained.bytes.toString(), reading.manifest.media.manifest)
        assert.equal(retained.digest.toString('hex'), reading.manifest.media.sha256)
      })
      const proposal = envelope(reading, '1', {
        kind: 'proposal',
        payload: {
          schema_version: 'bench-intake-proposal/2',
          subject_id: lotA.id,
          summary: 'Deterministic media descriptor receipt only; no model or image inspection.',
          sources: [
            {
              kind: 'media_version',
              evidence_id: ready.evidence_id,
              version_id: ready.version.id,
              sha256: ready.version.digest,
            },
          ],
        },
      })
      if (proposal.kind !== 'proposal') throw new Error('fixture_proposal_required')
      await assert.rejects(
        () =>
          acceptEnvelope(fixture.runner.pool, fixture.config, reading.channelToken, {
            ...proposal,
            payload: {
              ...proposal.payload,
              sources: [
                {
                  kind: 'media_version',
                  evidence_id: ready.evidence_id,
                  version_id: randomUUID(),
                  sha256: ready.version.digest,
                },
              ],
            },
          }),
        /runner_source_mismatch/,
      )
      assert.equal(
        await acceptEnvelope(fixture.runner.pool, fixture.config, reading.channelToken, proposal),
        'accepted',
      )
      assert.equal(
        await acceptEnvelope(fixture.runner.pool, fixture.config, reading.channelToken, proposal),
        'duplicate',
      )
      await acceptEnvelope(
        fixture.runner.pool,
        fixture.config,
        reading.channelToken,
        envelope(reading, '2', { kind: 'terminal', payload: { state: 'ready' } }),
      )
      const research = await claim(fixture, started.value.attempt_ids[1])

      await media.upload(lotB.id, 'Unrelated pending evidence')
      let activity = await fixture.http('/processing-activity')
      assert.equal(activity.status, 200)
      assert.equal(
        activity.value.jobs.find(
          (job: { attempt_id: string }) => job.attempt_id === research.payload.attempt_id,
        ).input_current,
        true,
      )
      await media.upload(partId, 'Relevant pending evidence')
      activity = await fixture.http('/processing-activity')
      assert.equal(activity.status, 200)
      assert.equal(activity.value.lane_occupied, true)
      assert.deepEqual(activity.value.jobs[0], {
        batch_id: batch.id,
        job_id: research.payload.job_id,
        attempt_id: research.payload.attempt_id,
        state: 'running',
        input_current: false,
        occupies_lane: true,
        blocked_code: 'media_not_ready',
      })
      const snapshot = await fixture.http(`/batches/${batch.id}/processing`)
      assert.equal(snapshot.status, 200)
      assert.equal(
        snapshot.value.jobs.find((job: { stage: string }) => job.stage === 'reading').proposals
          .length,
        1,
      )
      const staleProposal = envelope(research, '1', { kind: 'proposal', payload: proposal.payload })
      assert.equal(
        await acceptEnvelope(
          fixture.runner.pool,
          fixture.config,
          research.channelToken,
          staleProposal,
        ),
        'stale',
      )
      assert.equal((await fixture.http('/processing-activity')).value.lane_occupied, true)
      const authorityCounts = async () =>
        (
          await fixture.db.pool.query(
            'SELECT (SELECT count(*) FROM command) AS commands, (SELECT count(*) FROM processing_input) AS inputs, (SELECT count(*) FROM processing_attempt) AS attempts',
          )
        ).rows[0]
      const beforeRefusal = await authorityCounts()
      const refused = await fixture.http(`/batches/${batch.id}/processing`, input)
      assert.equal(refused.status, 409)
      assert.equal(refused.value.code, 'media_not_ready')
      assert.deepEqual(await authorityCounts(), beforeRefusal)
      assert.equal(
        await acceptEnvelope(
          fixture.runner.pool,
          fixture.config,
          research.channelToken,
          envelope(research, '2', {
            kind: 'question',
            payload: {
              kind: 'quantity',
              subject_id: lotA.id,
              prompt: 'Stale fixture prompt',
              reason: 'Relevant scope changed.',
            },
          }),
        ),
        'stale',
      )
      assert.equal((await fixture.http('/processing-activity')).value.lane_occupied, false)
      assert.equal(
        (await fixture.db.pool.query('SELECT count(*) FROM processing_question')).rows[0].count,
        '0',
      )
      // Relinking excludes the old Part's pending media while preserving the exact human quantity.
      await edit({ kind: 'add_part', label: 'Replacement Part' })
      const replacementPart = batch.parts.find(
        (part: { label: string }) => part.label === 'Replacement Part',
      )
      await edit({ kind: 'lot', id: lotA.id, part_subject_id: replacementPart.id })
      await media.edit({
        kind: 'link',
        evidence_id: ready.evidence_id,
        subject_id: replacementPart.id,
        linked: true,
      })
      const relinked = await fixture.http(`/batches/${batch.id}/processing`)
      assert.equal(relinked.status, 200)
      assert.ok(
        relinked.value.jobs.every(
          (job: { blocked_code?: string }) => job.blocked_code === undefined,
        ),
      )
      const fresh = await fixture.http(`/batches/${batch.id}/processing`, {
        ...input,
        expected_capture_revision: batch.revision,
        stages: ['reading'],
      })
      assert.equal(fresh.status, 202)
      const freshReading = await claim(fixture, fresh.value.attempt_ids[0])
      const freshScope = decodeMediaInputs(
        Buffer.from(freshReading.manifest.media.manifest),
        Buffer.from(freshReading.manifest.media.sha256, 'hex'),
      )
      assert.deepEqual(freshScope.subjectIds, [lotA.id, replacementPart.id].sort())
      assert.deepEqual(
        freshScope.versions.map((version) => version.versionId),
        [ready.version.id],
      )
      assert.ok('quantity' in freshReading.manifest.subject)
      assert.deepEqual(freshReading.manifest.subject.quantity, { mode: 'set', value: '17.000001' })
      await acceptEnvelope(
        fixture.runner.pool,
        fixture.config,
        freshReading.channelToken,
        envelope(freshReading, '1', {
          kind: 'question',
          payload: {
            kind: 'quantity',
            subject_id: lotA.id,
            prompt: 'Deterministic count confirmation',
            reason: 'Synthetic application-question fixture only.',
          },
        }),
      )
      const waiting = await fixture.http(`/batches/${batch.id}/processing`)
      const question = waiting.value.jobs
        .find((job: { stage: string }) => job.stage === 'reading')
        .questions.find((question: { state: string }) => question.state === 'open')
      assert.ok(question)
      await media.edit({
        kind: 'select_attachment',
        subject_id: lotA.id,
        mode: 'declined',
        version_id: null,
        destination: 'lot_attachment',
      })
      const changedSelection = await fixture.http(`/batches/${batch.id}/processing`)
      assert.equal(changedSelection.status, 200)
      assert.equal(
        changedSelection.value.jobs
          .find((job: { stage: string }) => job.stage === 'reading')
          .questions.find((value: { id: string }) => value.id === question.id).state,
        'superseded',
      )
      const staleAnswer = await fixture.http(
        `/batches/${batch.id}/questions/${question.id}/answers`,
        {
          schema_version: 'bench-intake-answer/1',
          expected_question_revision: question.revision,
          expected_capture_revision: batch.revision,
          attempt_id: question.attempt_id,
          input_sha256: question.input_sha256,
          value: { kind: 'quantity', value: '999', basis: 'counted' },
        },
      )
      assert.equal(staleAnswer.status, 412)
      assert.equal(staleAnswer.value.code, 'stale_question')
      assert.equal(
        (await fixture.db.pool.query('SELECT count(*) FROM processing_answer')).rows[0].count,
        '0',
      )
      const saved = await fixture.http(`/batches/${batch.id}`)
      assert.deepEqual(
        saved.value.lots.find((lot: { id: string }) => lot.id === lotA.id).quantity,
        { mode: 'set', value: '17.000001' },
      )
    } finally {
      await media?.dispose()
      await fixture.dispose()
    }
  },
)
