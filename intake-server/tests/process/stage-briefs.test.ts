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
import { seedPhoto } from '../support/sessions.ts'
import { decodeSessionInput } from '#/processing/session-input.ts'

/** Ready long enough ago that the worker's Examine sweep doesn't wait out its quiet period. */
const READY_SECONDS_AGO = 60

test(
  'under the switch a worker’s fake sessions start from sealed briefs and read them',
  { timeout: 180000 },
  async (t) => {
    const fixture = await processingFixture({ profileId: 'synthetic-session/1' })
    t.after(() => fixture.dispose())
    // The in-test API and the worker both run with the test-only switch.
    fixture.config.stageInputs = 'local'
    const capture = await fixture.seedCapture()
    const batchId = capture.batch.id
    const photo = await seedPhoto(
      fixture,
      batchId,
      { width: 768, height: 512 },
      'Tray',
      READY_SECONDS_AGO,
    )
    await fixture.db.pool.query(
      'INSERT INTO media_evidence_note(id,batch_id,evidence_id,revision,text,actor_id) VALUES($1,$2,$3,1,$4,$5)',
      [randomUUID(), batchId, photo.evidence, '16 MHz crystal', fixture.identity.actor],
    )
    const root = await mkdtemp(join(tmpdir(), 'stage-briefs-process-'))
    const stateRoot = join(root, 'state')
    await mkdir(stateRoot, { mode: 0o700 })
    const worker = spawn(
      process.execPath,
      [
        '--import',
        'tsx',
        fileURLToPath(new URL('../../src/agents/session/session-worker-main.ts', import.meta.url)),
      ],
      {
        cwd: fileURLToPath(new URL('../../', import.meta.url)),
        env: {
          PATH: process.env.PATH,
          HOME: root,
          USER: process.env.USER,
          INTAKE_AGENT_DATABASE_URL: fixture.runner.url,
          INTAKE_AGENT_WRITER_DATABASE_URL: fixture.writer.url,
          INTAKE_AGENT_SCHEDULER_DATABASE_URL: fixture.scheduler.url,
          INTAKE_AGENT_STATE_ROOT: stateRoot,
          INTAKE_ACTOR_ID: fixture.config.actorId,
          INTAKE_TARGET_ID: fixture.config.targetId,
          INTAKE_TARGET_CONTEXT_ID: fixture.config.targetContextId,
          INTAKE_PROCESSING_CHANNEL_SECRET: fixture.config.channelSecret,
          INTAKE_PROCESSING_PROFILE: 'synthetic-session/1',
          INTAKE_TEST_STAGE_INPUTS: 'local',
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
      const deadline = Date.now() + 90000
      let value = await read()
      while (!done(value) && Date.now() < deadline && worker.exitCode === null) {
        await delay(250)
        value = await read()
      }
      assert.ok(done(value), `${label}: ${JSON.stringify(value)}\n${output}`)
      return value
    }

    const research = async () =>
      (
        await fixture.db.pool.query<{
          attempt_id: string
          session_state: string
          input_bytes: Buffer
          input_digest: Buffer
        }>(
          `SELECT a.id AS attempt_id,s.session_state,i.manifest_bytes AS input_bytes,
             i.manifest_digest AS input_digest
           FROM processing_job j JOIN processing_attempt a ON a.id=j.current_attempt_id
           JOIN processing_input i ON i.id=a.input_id
           JOIN agent_session s ON s.attempt_id=a.id
           WHERE j.batch_id=$1 AND j.stage='research' AND j.subject_id IS NOT NULL
             AND j.subject_id NOT IN ($2,$3)`,
          [batchId, capture.packetA.id, capture.packetB.id],
        )
      ).rows[0]
    // The worker's sweep starts a `/7` lead, which forms the lot and queues its successors.
    const waiting = await until(
      research,
      (row) => row?.session_state === 'waiting_input',
      'the lot’s Research session reads its brief and asks',
    )
    const lead = await fixture.db.pool.query<{ manifest_bytes: Buffer; manifest_digest: Buffer }>(
      `SELECT i.manifest_bytes,i.manifest_digest FROM processing_job j
       JOIN processing_attempt a ON a.id=j.current_attempt_id
       JOIN processing_input i ON i.id=a.input_id WHERE j.batch_id=$1 AND j.stage='examine'`,
      [batchId],
    )
    assert.equal(
      decodeSessionInput(lead.rows[0].manifest_bytes, lead.rows[0].manifest_digest).schema_version,
      'bench-intake-input/7',
    )
    const sealed = decodeSessionInput(waiting.input_bytes, waiting.input_digest)
    assert.equal(sealed.schema_version, 'bench-intake-input/7')

    const status = await fixture.db.pool.query<{ text: string }>(
      `SELECT payload->>'text' AS text FROM agent_session_outbox
       WHERE session_id=$1 AND kind='status' ORDER BY seq LIMIT 1`,
      [waiting.attempt_id],
    )
    assert.match(status.rows[0].text, /^Read the brief at revision \d+: \d+ entries$/)
    const kept = await fixture.db.pool.query(
      'SELECT 1 FROM processing_brief_view WHERE attempt_id=$1',
      [waiting.attempt_id],
    )
    assert.equal(kept.rowCount, 1)
    const asked = await fixture.db.pool.query<{ kind: string }>(
      "SELECT kind FROM agent_session_outbox WHERE session_id=$1 AND kind='question'",
      [waiting.attempt_id],
    )
    assert.equal(asked.rowCount, 1)
  },
)
