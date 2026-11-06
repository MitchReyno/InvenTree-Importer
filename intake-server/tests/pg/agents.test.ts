import { validate, type ProcessingReceiptDto } from '@invimport/contracts'
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { strictJson } from '@invimport/contracts/json'
import { processingFixture } from '../support/processing.ts'
import { readAgentSettings, saveAgentSettings } from '../../src/agents/settings.ts'
import { listAgentSessions } from '../../src/agents/sessions.ts'
import { claimProcessingCommand, acceptEnvelope } from '../../src/processing/runner.ts'
import { acquireAgentSupervisor } from '../../src/agents/worker.ts'
import { startProcessing } from '../../src/processing/commands.ts'
import { nativeProfileId } from '../../src/agents/policy.ts'
import { stageNativePrompt } from '../../src/agents/prompt.ts'
import { automationNoteId } from '../../src/capture/context-input.ts'
import type { BlobStore } from '../../src/media/blob-store.ts'

const first = { provider: 'codex', authentication: 'subscription', model: 'gpt-test-one' } as const
const second = { provider: 'claude', authentication: 'api_key', model: 'sonnet' } as const

test('native settings bind at queue time, conflict safely, survive completion and remain scoped', async () => {
  const fixture = await processingFixture({ profileId: nativeProfileId })
  try {
    const capture = await fixture.seedCapture()
    assert.deepEqual(await readAgentSettings(fixture.api.pool, fixture.config), {
      revision: '0',
      selection: null,
      session_concurrency: 3,
    })
    const start = {
      schema_version: 'bench-intake-processing/1',
      expected_capture_revision: capture.batch.revision,
      subject_ids: [capture.packetA.id],
      stages: ['reading'],
    } as const
    const request = { ...start, subject_ids: [...start.subject_ids], stages: [...start.stages] }
    await assert.rejects(
      startProcessing(fixture.api.pool, fixture.config, capture.batch.id, randomUUID(), request),
      { message: 'agent_default_required' },
    )
    await saveAgentSettings(fixture.api.pool, fixture.config, {
      expected_revision: '0',
      selection: first,
    })
    const queued = receipt(
      await startProcessing(
        fixture.api.pool,
        fixture.config,
        capture.batch.id,
        randomUUID(),
        request,
      ),
    )
    await saveAgentSettings(fixture.api.pool, fixture.config, {
      expected_revision: '1',
      selection: second,
    })
    await assert.rejects(
      saveAgentSettings(fixture.api.pool, fixture.config, {
        expected_revision: '1',
        selection: first,
      }),
      { message: 'revision_conflict' },
    )
    let history = await listAgentSessions(fixture.api.pool, fixture.config)
    assert.equal(history.sessions.length, 1)
    assert.deepEqual(history.sessions[0].selection, first)
    assert.equal(history.sessions[0].settings_revision, '1')
    const retained = await fixture.db.pool.query(
      'SELECT workflow_id,payload_bytes FROM command WHERE id=(SELECT command_id FROM processing_attempt WHERE id=$1)',
      [queued.attempt_ids[0]],
    )
    const command = retained.rows[0]
    const claimed = await claimProcessingCommand(
      fixture.runner.pool,
      fixture.config,
      command.workflow_id,
      strictJson(command.payload_bytes.toString()),
      'processing/4',
    )
    assert.ok(claimed)
    const manifest = claimed.manifest
    assert.equal(manifest.schema_version, 'bench-intake-input/4')
    await assert.rejects(acquireAgentSupervisor(fixture.runner.pool, fixture.config), {
      message: 'agent_reap_confirmation_required',
    })
    history = await listAgentSessions(fixture.api.pool, fixture.config)
    assert.equal(history.sessions[0].occupies_lane, true)
    await acceptEnvelope(fixture.runner.pool, fixture.config, claimed.channelToken, {
      schema_version: 'bench-intake-runner/4',
      job_id: claimed.payload.job_id,
      attempt_id: claimed.payload.attempt_id,
      command_id: claimed.payload.command_id,
      input_sha256: claimed.payload.input_sha256,
      profile_id: nativeProfileId,
      handler_version: 'processing/4',
      sequence: '1',
      kind: 'terminal',
      payload: { state: 'failed' },
    })
    history = await listAgentSessions(fixture.api.pool, fixture.config)
    assert.equal(history.sessions[0].state, 'failed')
    assert.equal(history.sessions[0].occupies_lane, false)
    const next = receipt(
      await startProcessing(
        fixture.api.pool,
        fixture.config,
        capture.batch.id,
        randomUUID(),
        request,
      ),
    )
    assert.notEqual(next.attempt_ids[0], queued.attempt_ids[0])
    history = await listAgentSessions(fixture.api.pool, fixture.config)
    assert.deepEqual(history.sessions[0].selection, second)
    assert.equal(history.sessions.length, 2)
    assert.equal(
      (await listAgentSessions(fixture.api.pool, { ...fixture.config, actorId: randomUUID() }))
        .sessions.length,
      0,
    )
    assert.deepEqual(
      await readAgentSettings(fixture.api.pool, { ...fixture.config, actorId: randomUUID() }),
      { revision: '0', selection: null, session_concurrency: 3 },
    )
    await assert.rejects(
      listAgentSessions(
        fixture.api.pool,
        { ...fixture.config, actorId: randomUUID() },
        queued.attempt_ids[0],
      ),
      { message: 'invalid_session_cursor' },
    )
    await assert.rejects(fixture.runner.pool.query("UPDATE agent_settings SET model='forbidden'"), {
      code: '42501',
    })
    await assert.rejects(fixture.api.pool.query("UPDATE agent_session SET progress='settled'"), {
      code: '42501',
    })
  } finally {
    await fixture.dispose()
  }
})

test('a second native supervisor cannot acquire the actor lock even with no queued work', async () => {
  const fixture = await processingFixture({ profileId: nativeProfileId })
  try {
    const owner = await acquireAgentSupervisor(fixture.runner.pool, fixture.config)
    try {
      await assert.rejects(acquireAgentSupervisor(fixture.runner.pool, fixture.config), {
        message: 'agent_supervisor_already_running',
      })
    } finally {
      owner.release(true)
    }
    const replacement = await acquireAgentSupervisor(fixture.runner.pool, fixture.config)
    replacement.release(true)
  } finally {
    await fixture.dispose()
  }
})

function receipt(value: unknown): ProcessingReceiptDto {
  validate('ProcessingReceipt', value)
  return value as ProcessingReceiptDto
}

test('session history pages every retained attempt in queue order and refuses identity edits', async () => {
  const fixture = await processingFixture({ profileId: nativeProfileId })
  try {
    const capture = await fixture.seedCapture()
    await saveAgentSettings(fixture.api.pool, fixture.config, {
      expected_revision: '0',
      selection: first,
    })
    const ids = new Set<string>()
    for (let index = 0; index < 53; index++) {
      const queued = receipt(
        await startProcessing(fixture.api.pool, fixture.config, capture.batch.id, randomUUID(), {
          schema_version: 'bench-intake-processing/1',
          expected_capture_revision: capture.batch.revision,
          subject_ids: [capture.packetA.id],
          stages: ['reading'],
        }),
      )
      ids.add(queued.attempt_ids[0])
    }
    const newest = await listAgentSessions(fixture.api.pool, fixture.config)
    assert.equal(newest.sessions.length, 50)
    assert.ok(newest.next_before)
    const older = await listAgentSessions(fixture.api.pool, fixture.config, newest.next_before)
    assert.equal(older.sessions.length, 3)
    assert.equal(older.next_before, null)
    // native-agent/1 runs one-shot attempts, not sessions.
    assert.equal(newest.sessions_supported, false)
    const all = [...newest.sessions, ...older.sessions]
    assert.deepEqual(new Set(all.map((session) => session.attempt_id)), ids)
    assert.ok(
      all.every((session, index) => index === 0 || session.queued_at <= all[index - 1].queued_at),
    )
    await assert.rejects(
      fixture.db.pool.query(
        "UPDATE agent_session SET queued_at=queued_at + interval '1 second' WHERE attempt_id=$1",
        [all[0].attempt_id],
      ),
      /agent_session_identity_immutable/,
    )
  } finally {
    await fixture.dispose()
  }
})

test('a native prompt shows requested automation as context but never offers it as a source', async () => {
  const fixture = await processingFixture({ profileId: nativeProfileId })
  try {
    const capture = await fixture.seedCapture()
    await capture.edit({
      kind: 'batch_settings',
      title: capture.batch.title,
      default_location: { mode: 'unset' },
      intent: {
        supplier: { absent: false, selection: { mode: 'unset' } },
        order: { reference: { mode: 'auto' }, purchase_date: { mode: 'auto' } },
        shared_tags: { manual: [], auto: true },
      },
      notes: { batch: null, order: null },
      drafts: [],
    })
    await saveAgentSettings(fixture.api.pool, fixture.config, {
      expected_revision: '0',
      selection: first,
    })
    const queued = receipt(
      await startProcessing(fixture.api.pool, fixture.config, capture.batch.id, randomUUID(), {
        schema_version: 'bench-intake-processing/1',
        expected_capture_revision: capture.batch.revision,
        subject_ids: [capture.packetA.id],
        stages: ['reading'],
      }),
    )
    const retained = await fixture.db.pool.query(
      'SELECT workflow_id,payload_bytes FROM command WHERE id=(SELECT command_id FROM processing_attempt WHERE id=$1)',
      [queued.attempt_ids[0]],
    )
    const claimed = await claimProcessingCommand(
      fixture.runner.pool,
      fixture.config,
      retained.rows[0].workflow_id,
      strictJson(retained.rows[0].payload_bytes.toString()),
      'processing/4',
    )
    assert.ok(claimed)
    assert.equal(claimed.manifest.schema_version, 'bench-intake-input/4')
    const intentId = automationNoteId(capture.batch.id)
    assert.ok(claimed.manifest.notes.some((note) => note.id === intentId))
    const prompt = await stageNativePrompt(
      fixture.runner.pool,
      fixture.config,
      {} as BlobStore,
      claimed,
      claimed.manifest,
    )
    const cited = prompt.sources.flatMap((source) =>
      source.kind === 'note' ? [source.note_id] : [],
    )
    assert.ok(cited.length > 0, 'real notes remain citable')
    assert.equal(cited.includes(intentId), false)
    assert.ok(prompt.text.includes(intentId), 'the request is still visible as context')
  } finally {
    await fixture.dispose()
  }
})
