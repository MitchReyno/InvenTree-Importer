import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { processingFixture } from '../support/processing.ts'
import { lotSession } from '../support/sessions.ts'
import { runSessionTurn } from '#/agents/session/session-runner.ts'
import { SessionCapacityUnavailable } from '#/agents/session/session-adapters.ts'
import { wakePendingSessions } from '#/agents/session/session-execution.ts'

type Fixture = Awaited<ReturnType<typeof processingFixture>>

async function sessionRow(fixture: Fixture, attemptId: string) {
  const rows = await fixture.db.pool.query<{
    session_state: string
    turn_count: string
    queued_since: Date
    capability: boolean
    progress: string
    finished_at: Date | null
    attempt_state: string
  }>(
    `SELECT session.session_state, session.turn_count::text, session.queued_since,
            session.capability_sha256 IS NOT NULL AS capability, session.progress,
            session.finished_at, attempt.state AS attempt_state
       FROM agent_session session
       JOIN processing_attempt attempt ON attempt.id = session.attempt_id
      WHERE session.attempt_id=$1`,
    [attemptId],
  )
  return rows.rows[0]
}

test('a turn that finds no free connection goes back to the queue as if it never ran', async (t) => {
  const fixture = await processingFixture()
  t.after(() => fixture.dispose())
  const capture = await fixture.seedCapture()
  const { attempt } = await lotSession(fixture, capture, capture.packetA, { state: 'queued' })
  // A woken session keeps the state its wake came from until a turn runs.
  await fixture.db.pool.query(
    "INSERT INTO agent_session_resume(attempt_id,from_state) VALUES($1,'finished')",
    [attempt],
  )
  const before = await sessionRow(fixture, attempt)
  const root = await mkdtemp(join(tmpdir(), 'turn-capacity-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  let recorded = 0

  const state = await runSessionTurn(
    {
      pool: fixture.runner.pool,
      config: fixture.config,
      host: { stateRoot: root, env: {}, claudeExecutable: '/unused', codexExecutable: '/unused' },
      toolUrl: 'http://127.0.0.1:1',
      drivers: {
        'synthetic-session/1': async (_turn, context) => {
          // Held while the driver waits: claimed with nothing started.
          const slot = await fixture.db.pool.query<{ turn_child: string }>(
            'SELECT turn_child FROM agent_slot WHERE attempt_id=$1',
            [attempt],
          )
          recorded = slot.rowCount ?? 0
          assert.equal(slot.rows[0].turn_child, 'none')
          assert.ok(context.recordChild)
          throw new SessionCapacityUnavailable()
        },
      },
    },
    attempt,
    new AbortController().signal,
  )

  assert.equal(state, 'queued')
  assert.equal(recorded, 1)
  const after = await sessionRow(fixture, attempt)
  assert.deepEqual(after, { ...before, capability: false })
  assert.equal(after.attempt_state, 'queued')
  const slots = await fixture.db.pool.query('SELECT 1 FROM agent_slot WHERE attempt_id=$1', [
    attempt,
  ])
  assert.equal(slots.rowCount, 0)
  const failures = await fixture.db.pool.query(
    'SELECT 1 FROM agent_session_failure WHERE attempt_id=$1',
    [attempt],
  )
  assert.equal(failures.rowCount, 0)
  const resume = await fixture.db.pool.query(
    'SELECT from_state FROM agent_session_resume WHERE attempt_id=$1',
    [attempt],
  )
  assert.deepEqual(resume.rows, [{ from_state: 'finished' }])

  // The wake sweep gives it a fresh workflow once its command workflow has ended, once a minute.
  const command = await fixture.db.pool.query<{ workflow_id: string }>(
    `SELECT command.workflow_id FROM command
       JOIN processing_attempt attempt ON attempt.command_id = command.id
      WHERE attempt.id=$1`,
    [attempt],
  )
  const workflows = new Map<string, string>([[command.rows[0].workflow_id, 'SUCCESS']])
  const enqueued: string[] = []
  const scheduler = {
    getWorkflow: async (id: string) =>
      workflows.has(id) ? { status: workflows.get(id) } : undefined,
    enqueue: async (options: { workflowID: string }) => {
      enqueued.push(options.workflowID)
      workflows.set(options.workflowID, 'SUCCESS')
    },
  }
  await wakePendingSessions(fixture.runner.pool, fixture.config, scheduler as never)
  await wakePendingSessions(fixture.runner.pool, fixture.config, scheduler as never)
  // One per minute bucket: two only if the sweeps straddled a minute.
  assert.ok(enqueued.length >= 1 && new Set(enqueued).size === enqueued.length, String(enqueued))
  for (const id of enqueued) {
    assert.match(id, new RegExp(`^resume:${attempt}:0:`))
  }
})
