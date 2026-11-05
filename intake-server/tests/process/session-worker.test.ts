import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { mkdtemp, mkdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { setTimeout as delay } from 'node:timers/promises'
import { processingFixture } from '../support/processing.ts'

type Job = {
  id: string
  state: string
  attempt_id: string
  input_sha256: string
  proposals: { value: { relies_on?: { sources: { kind: string }[] } } }[]
  questions: { id: string; state: string; revision: string; assumption?: string }[]
}

test(
  'the session worker runs a synthetic session, waits for an answer and resumes with it',
  { timeout: 120000 },
  async (t) => {
    const fixture = await processingFixture({ profileId: 'synthetic-session/1' })
    t.after(() => fixture.dispose())
    const capture = await fixture.seedCapture()
    const root = await mkdtemp(join(tmpdir(), 'session-worker-test-'))
    const stateRoot = join(root, 'state')
    await mkdir(stateRoot, { mode: 0o700 })
    const worker = spawn(
      process.execPath,
      [
        '--import',
        'tsx',
        fileURLToPath(new URL('../../src/agents/session-worker-main.ts', import.meta.url)),
      ],
      {
        cwd: fileURLToPath(new URL('../../', import.meta.url)),
        env: {
          PATH: process.env.PATH,
          HOME: root,
          USER: process.env.USER,
          INTAKE_AGENT_DATABASE_URL: fixture.runner.url,
          INTAKE_AGENT_SCHEDULER_DATABASE_URL: fixture.scheduler.url,
          INTAKE_AGENT_STATE_ROOT: stateRoot,
          INTAKE_ACTOR_ID: fixture.config.actorId,
          INTAKE_TARGET_ID: fixture.config.targetId,
          INTAKE_TARGET_CONTEXT_ID: fixture.config.targetContextId,
          INTAKE_PROCESSING_CHANNEL_SECRET: fixture.config.channelSecret,
          INTAKE_PROCESSING_PROFILE: 'synthetic-session/1',
        },
        stdio: ['ignore', 'pipe', 'pipe'],
      },
    )
    let output = ''
    worker.stdout.on('data', (bytes: Buffer) => (output += bytes.toString()))
    worker.stderr.on('data', (bytes: Buffer) => (output += bytes.toString()))
    const exited = new Promise<number | null>((resolve) => worker.once('exit', resolve))
    t.after(async () => {
      if (worker.exitCode === null) {
        worker.kill('SIGTERM')
        await exited
      }
    })
    const until = async <T>(read: () => Promise<T>, done: (value: T) => boolean, label: string) => {
      const deadline = Date.now() + 40000
      let value = await read()
      while (!done(value) && Date.now() < deadline && worker.exitCode === null) {
        await delay(200)
        value = await read()
      }
      assert.ok(done(value), `${label}: ${JSON.stringify(value)}\n${output}`)
      return value
    }
    await until(
      async () => output,
      (text) => text.includes('session supervisor ready'),
      'ready',
    )

    const started = await fixture.http(`/batches/${capture.batch.id}/processing`, {
      schema_version: 'bench-intake-processing/1',
      expected_capture_revision: capture.batch.revision,
      subject_ids: [capture.packetA.id],
      stages: ['research'],
    })
    assert.equal(started.status, 202, JSON.stringify(started.value))
    const job = async () =>
      ((await fixture.http(`/batches/${capture.batch.id}/processing`)).value as { jobs: Job[] })
        .jobs[0]

    const waiting = await until(
      job,
      (value) => value?.state === 'waiting_for_user',
      'first turn waits',
    )
    assert.equal(waiting.proposals.length, 1)
    const question = waiting.questions[0]
    assert.equal(question.state, 'open')
    assert.equal(question.assumption, 'Treating the lot as one item until answered.')

    const batch = (await fixture.http(`/batches/${capture.batch.id}`)).value as { revision: string }
    const answered = await fixture.http(
      `/batches/${capture.batch.id}/questions/${question.id}/answers`,
      {
        schema_version: 'bench-intake-answer/1',
        expected_question_revision: question.revision,
        expected_capture_revision: batch.revision,
        attempt_id: waiting.attempt_id,
        input_sha256: waiting.input_sha256,
        value: { kind: 'quantity', value: '12', basis: 'counted' },
      },
      randomUUID(),
    )
    assert.equal(answered.status, 200, JSON.stringify(answered.value))

    const finished = await until(
      job,
      (value) => value?.state === 'ready' && value.proposals.length === 2,
      'resumed turn finishes',
    )
    const latest = finished.proposals.find((proposal) =>
      proposal.value.relies_on?.sources.some((source) => source.kind === 'inbox_item'),
    )
    assert.ok(latest, 'the resumed proposal relies on the answer it read')
    const outbox = await fixture.db.pool.query<{ kind: string }>(
      'SELECT kind FROM agent_session_outbox WHERE session_id=$1 ORDER BY seq',
      [waiting.attempt_id],
    )
    // The resumed turn's status line may fall inside the status rate limit, so it is optional.
    assert.equal(outbox.rows[0].kind, 'status')
    assert.deepEqual(
      outbox.rows.map((row) => row.kind).filter((kind) => kind !== 'status'),
      ['proposal', 'question', 'proposal'],
    )
    const session = await fixture.db.pool.query<{
      session_state: string
      capability_sha256: Buffer | null
    }>('SELECT session_state,capability_sha256 FROM agent_session WHERE attempt_id=$1', [
      waiting.attempt_id,
    ])
    assert.deepEqual(session.rows[0], { session_state: 'finished', capability_sha256: null })
  },
)
