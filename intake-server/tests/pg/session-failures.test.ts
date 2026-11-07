import { test } from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { processingFixture } from '../support/processing.ts'
import { lotSession } from '../support/sessions.ts'
import { interruptRunningSessions, runSessionTurn } from '../../src/agents/session-runner.ts'
import { NativeSessionError } from '../../src/agents/failure-model.ts'
import { readSessionFailure } from '../../src/agents/failures.ts'
import { ResearchReapPendingError } from '../../src/research/errors.ts'
import type {
  SessionFailureDto,
  SessionTimelineDto,
  AgentSessionListDto,
} from '@invimport/contracts'

for (const mode of ['retained', 'storage_failure', 'reap_pending'] as const) {
  test(`session failure ${mode} preserves settlement, scope and safe details`, async () => {
    const fixture = await processingFixture({ profileId: 'synthetic-session/1' })
    const root = await mkdtemp(join(tmpdir(), 'session-diagnostics-'))
    try {
      const capture = await fixture.seedCapture()
      const session = await lotSession(fixture, capture, capture.packetA, { state: 'queued' })
      if (mode === 'storage_failure') {
        await fixture.db.pool.query(
          'ALTER TABLE agent_session_failure ADD CONSTRAINT reject_diagnostic CHECK(false)',
        )
      }
      const secret = `private-token ${join(root, 'private-file')} SQL credentials`
      const deps = {
        pool: fixture.runner.pool,
        config: fixture.config,
        host: { codexExecutable: 'unused', claudeExecutable: 'unused', stateRoot: root, env: {} },
        toolUrl: 'http://127.0.0.1:1/unused',
        drivers: {
          'synthetic-session/1': async () => {
            if (mode === 'reap_pending') {
              throw new ResearchReapPendingError()
            }
            throw new NativeSessionError('agent_tool_refused', { cause: new Error(secret) })
          },
        },
      }
      if (mode === 'reap_pending') {
        await assert.rejects(
          runSessionTurn(deps, session.attempt, new AbortController().signal),
          ResearchReapPendingError,
        )
      } else {
        assert.equal(
          await runSessionTurn(deps, session.attempt, new AbortController().signal),
          'failed',
        )
      }
      const slots = await fixture.db.pool.query(
        'SELECT attempt_id FROM agent_slot WHERE attempt_id=$1',
        [session.attempt],
      )
      assert.equal(slots.rowCount, mode === 'reap_pending' ? 1 : 0)
      const stored = await fixture.db.pool.query<{ diagnostic: SessionFailureDto }>(
        'SELECT diagnostic FROM agent_session_failure WHERE attempt_id=$1',
        [session.attempt],
      )
      if (mode === 'storage_failure') {
        assert.equal(stored.rowCount, 0)
        const state = await fixture.db.pool.query(
          'SELECT session_state FROM agent_session WHERE attempt_id=$1',
          [session.attempt],
        )
        assert.equal(state.rows[0].session_state, 'failed')
        return
      }
      assert.equal(stored.rowCount, 1)
      const failure = stored.rows[0].diagnostic
      assert.equal(failure.turn, '1')
      assert.equal(failure.category, mode === 'reap_pending' ? 'interrupted' : 'tool_policy')
      assert.equal(JSON.stringify(failure).includes(secret), false)
      const details = await fixture.http(
        `/agent-sessions/${session.attempt}/failures/${failure.id}`,
      )
      assert.equal(details.status, 200)
      assert.deepEqual(details.value, failure)
      for (const field of ['actorId', 'targetId', 'targetContextId'] as const) {
        await assert.rejects(
          readSessionFailure(
            fixture.api.pool,
            { ...fixture.config, [field]: randomUUID() },
            session.attempt,
            failure.id,
          ),
          /session_failure_not_found/,
        )
      }
      await assert.rejects(
        readSessionFailure(fixture.api.pool, fixture.config, randomUUID(), failure.id),
        /session_failure_not_found/,
      )
      const history = (await fixture.http('/agent-sessions')).value as AgentSessionListDto
      assert.equal(history.sessions[0].failure?.id, failure.id)
      assert.equal('causes' in history.sessions[0].failure!, false)
      const timeline = (
        await fixture.http(`/batches/${capture.batch.id}/processing/${session.job}/session`)
      ).value as SessionTimelineDto
      assert.equal(timeline.failure?.id, failure.id)
      await fixture.db.pool.query(
        'UPDATE agent_session SET turn_count=turn_count+1 WHERE attempt_id=$1',
        [session.attempt],
      )
      const later = (await fixture.http('/agent-sessions')).value as AgentSessionListDto
      assert.equal(
        later.sessions[0].failure,
        undefined,
        'An earlier failure is never presented as current-turn details',
      )
      assert.deepEqual(
        await readSessionFailure(fixture.api.pool, fixture.config, session.attempt, failure.id),
        failure,
      )
      await assert.rejects(fixture.api.pool.query('DELETE FROM agent_session_failure'))
      await assert.rejects(
        fixture.runner.pool.query('UPDATE agent_session_failure SET diagnostic=diagnostic'),
      )
    } finally {
      await fixture.dispose()
      await rm(root, { recursive: true, force: true })
    }
  })
}

test('worker recovery retains an interruption diagnostic without provider metadata', async () => {
  const fixture = await processingFixture({ profileId: 'synthetic-session/1' })
  try {
    const capture = await fixture.seedCapture()
    const session = await lotSession(fixture, capture, capture.packetA, { state: 'running' })
    assert.deepEqual(await interruptRunningSessions(fixture.runner.pool, fixture.config), [
      session.attempt,
    ])
    const stored = await fixture.db.pool.query<{ diagnostic: SessionFailureDto }>(
      'SELECT diagnostic FROM agent_session_failure WHERE attempt_id=$1',
      [session.attempt],
    )
    assert.equal(stored.rowCount, 1)
    const failure = stored.rows[0].diagnostic
    assert.equal(failure.code, 'agent_worker_interrupted')
    assert.equal(failure.category, 'interrupted')
    assert.equal(failure.provider, null)
    assert.equal(failure.cli_version, null)
    const history = (await fixture.http('/agent-sessions')).value as AgentSessionListDto
    assert.equal(history.sessions[0].failure?.id, failure.id)
  } finally {
    await fixture.dispose()
  }
})
