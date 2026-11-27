import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { mkdtemp, mkdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { setTimeout as delay } from 'node:timers/promises'
import { processingFixture } from '../support/processing.ts'
import { seedPhoto } from '../support/sessions.ts'
import { decodeSessionInput } from '#/processing/session-input.ts'

type Fixture = Awaited<ReturnType<typeof processingFixture>>

/** Ready long enough ago that the worker's Examine sweep doesn't wait out its quiet period. */
const READY_SECONDS_AGO = 60
/** How long a worker may take to reach a state the test waits for. */
const WAIT_MS = 90_000
/** How long a stopping worker may take to drain before it is killed. */
const STOP_GRACE_MS = 15_000

/** A photo whose note scripts what the synthetic lead sees in it. */
async function notedPhoto(fixture: Fixture, batchId: string, label: string, note: string) {
  const photo = await seedPhoto(
    fixture,
    batchId,
    { width: 768, height: 512 },
    label,
    READY_SECONDS_AGO,
  )
  await fixture.db.pool.query(
    'INSERT INTO media_evidence_note(id,batch_id,evidence_id,revision,text,actor_id) VALUES($1,$2,$3,1,$4,$5)',
    [randomUUID(), batchId, photo.evidence, note, fixture.identity.actor],
  )
}

/** A worker's home and private state root, kept across its restarts as a deployment keeps them. */
async function workerRoot() {
  const root = await mkdtemp(join(tmpdir(), 'stage-briefs-process-'))
  await mkdir(join(root, 'state'), { mode: 0o700 })
  return root
}

/**
 * What a test owns, released in reverse: workers stop (and their children are reaped) before
 * the fixture's database goes and the worker root is removed. Registered as soon as the
 * fixture exists, so a failure during setup still releases what was acquired; a worker whose
 * exit can't be confirmed stops the release there.
 */
function ownedResources(t: { after: (fn: () => Promise<void>) => void }) {
  const releases: (() => Promise<void>)[] = []
  t.after(async () => {
    // A release that fails (a worker whose exit isn't confirmed) keeps everything acquired
    // before it, such as the database that worker may still use, and the test reports it.
    const ordered = releases.reverse()
    for (const [index, release] of ordered.entries()) {
      try {
        await release()
      } catch (error) {
        throw new Error(
          `stage_briefs_cleanup_stopped: ${ordered.length - index - 1} earlier resources kept`,
          { cause: error },
        )
      }
    }
  })
  return (release: () => Promise<void>) => releases.push(release)
}

/** A session worker child for the fixture's actor; `stop` sends SIGTERM and waits for its exit. */
async function startWorker(
  fixture: Fixture,
  root: string,
  stageInputs: boolean,
  extraEnv: Record<string, string> = {},
) {
  const stateRoot = join(root, 'state')
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
        ...(stageInputs ? { INTAKE_TEST_STAGE_INPUTS: 'local' } : {}),
        ...extraEnv,
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  )
  let output = ''
  worker.stdout.on('data', (bytes: Buffer) => (output += bytes.toString()))
  worker.stderr.on('data', (bytes: Buffer) => (output += bytes.toString()))
  // Settles on exit, or on a spawn failure, which emits `error` and no `exit`.
  const exited = new Promise<void>((resolve) => {
    worker.once('exit', () => resolve())
    worker.once('error', () => resolve())
  })

  const until = async <T>(read: () => Promise<T>, done: (value: T) => boolean, label: string) => {
    const deadline = Date.now() + WAIT_MS
    let value = await read()
    while (!done(value) && Date.now() < deadline && worker.exitCode === null) {
      await delay(250)
      value = await read()
    }
    assert.ok(done(value), `${label}: ${JSON.stringify(value)}\n${output}`)
    return value
  }

  // SIGTERM, then SIGKILL if the worker hasn't exited within the grace period; either way the
  // child is reaped before this returns.
  const stop = async () => {
    if (worker.exitCode !== null || worker.signalCode !== null) {
      return
    }
    worker.kill('SIGTERM')
    const graceful = await Promise.race([
      exited.then(() => true),
      delay(STOP_GRACE_MS).then(() => false),
    ])
    if (graceful) {
      return
    }
    worker.kill('SIGKILL')
    const reaped = await Promise.race([
      exited.then(() => true),
      delay(STOP_GRACE_MS).then(() => false),
    ])
    // An unreaped child isn't safe to tear its database down under; say so instead.
    if (!reaped) {
      throw new Error(`worker_not_reaped:${worker.pid}`)
    }
  }

  /** The worker's exit, within `WAIT_MS`, with everything it wrote. */
  const exit = async () => {
    const ended = await Promise.race([exited.then(() => true), delay(WAIT_MS).then(() => false)])
    assert.ok(ended, `the worker exits: ${output}`)
    return { code: worker.exitCode, output }
  }

  return { until, stop, exit }
}

/** Each Research and Images job of a lot, by its label, with its sealed input version. */
async function successors(fixture: Fixture, batchId: string, label: string) {
  const rows = await fixture.db.pool.query<{
    stage: string
    session_state: string
    attempt_id: string
    input_bytes: Buffer
    input_digest: Buffer
  }>(
    `SELECT j.stage,s.session_state,a.id AS attempt_id,i.manifest_bytes AS input_bytes,
       i.manifest_digest AS input_digest
     FROM processing_job j JOIN capture_subject c ON c.id=j.subject_id
     JOIN processing_attempt a ON a.id=j.current_attempt_id
     JOIN processing_input i ON i.id=a.input_id
     JOIN agent_session s ON s.attempt_id=a.id
     WHERE j.batch_id=$1 AND c.label=$2 AND j.stage IN ('research','images') ORDER BY j.stage`,
    [batchId, label],
  )
  return rows.rows.map((row) => ({
    stage: row.stage,
    sessionState: row.session_state,
    attemptId: row.attempt_id,
    version: decodeSessionInput(row.input_bytes, row.input_digest).schema_version,
  }))
}

/** The kinds a job's attempts published, in order. */
async function publishedKinds(fixture: Fixture, batchId: string, stage: string) {
  const rows = await fixture.db.pool.query<{ kind: string }>(
    `SELECT convert_from(p.value_bytes,'UTF8')::jsonb->>'schema_version' AS kind
     FROM processing_proposal p JOIN processing_attempt a ON a.id=p.attempt_id
     JOIN processing_job j ON j.id=a.job_id JOIN processing_message m ON m.id=p.message_id
     WHERE j.batch_id=$1 AND j.stage=$2 ORDER BY a.number, m.sequence`,
    [batchId, stage],
  )
  return rows.rows.map((row) => row.kind)
}

async function leadVersion(fixture: Fixture, batchId: string) {
  const lead = await fixture.db.pool.query<{ manifest_bytes: Buffer; manifest_digest: Buffer }>(
    `SELECT i.manifest_bytes,i.manifest_digest FROM processing_job j
     JOIN processing_attempt a ON a.id=j.current_attempt_id
     JOIN processing_input i ON i.id=a.input_id WHERE j.batch_id=$1 AND j.stage='examine'`,
    [batchId],
  )
  const row = lead.rows[0]
  return row ? decodeSessionInput(row.manifest_bytes, row.manifest_digest).schema_version : null
}

test(
  'under the switch a worker’s fake sessions start from sealed briefs and read them',
  { timeout: 180000 },
  async (t) => {
    const own = ownedResources(t)
    const fixture = await processingFixture({ profileId: 'synthetic-session/1' })
    own(() => fixture.dispose())
    // The in-test API and the worker both run with the test-only switch.
    fixture.config.stageInputs = 'local'
    const capture = await fixture.seedCapture()
    const batchId = capture.batch.id
    await notedPhoto(fixture, batchId, 'Tray', '16 MHz crystal')
    const root = await workerRoot()
    own(() => rm(root, { recursive: true, force: true }))
    const worker = await startWorker(fixture, root, true)
    own(() => worker.stop())

    // The worker's sweep starts a `/7` lead, which forms the lot and queues its successors.
    // Both ask the same quantity question; the first asks it and waits, and the other is given
    // that question instead and finishes.
    const settled = ['waiting_input', 'finished']
    const rows = await worker.until(
      () => successors(fixture, batchId, '16 mhz crystal'),
      (found) =>
        found.length === 2 &&
        found.every((row) => settled.includes(row.sessionState)) &&
        found.some((row) => row.sessionState === 'waiting_input'),
      'the lot’s sessions read their briefs, and one asks',
    )
    const research = rows[1]
    assert.equal(research.stage, 'research')
    assert.equal(await leadVersion(fixture, batchId), 'bench-intake-input/7')
    assert.equal(research.version, 'bench-intake-input/7')

    const status = await fixture.db.pool.query<{ text: string }>(
      `SELECT payload->>'text' AS text FROM agent_session_outbox
       WHERE session_id=$1 AND kind='status' ORDER BY seq LIMIT 1`,
      [research.attemptId],
    )
    assert.match(status.rows[0].text, /^Read the brief at revision \d+: \d+ entries$/)
    const kept = await fixture.db.pool.query(
      'SELECT 1 FROM processing_brief_view WHERE attempt_id=$1',
      [research.attemptId],
    )
    assert.equal(kept.rowCount, 1)
    const asked = await fixture.db.pool.query(
      'SELECT 1 FROM processing_question WHERE batch_id=$1',
      [batchId],
    )
    assert.equal(asked.rowCount, 1)
    // The lead formed the lot without a count and published Examine's typed identity, and
    // Research published its own typed output, both accepted.
    assert.deepEqual(await publishedKinds(fixture, batchId, 'examine'), ['examine-identity/1'])
    assert.deepEqual(await publishedKinds(fixture, batchId, 'research'), ['research/1'])
    const formed = await fixture.db.pool.query<{ command: { tool: string } }>(
      `SELECT convert_from(command_bytes,'UTF8')::jsonb AS command FROM capture_revision
       WHERE batch_id=$1 AND agent_session_id IS NOT NULL`,
      [batchId],
    )
    const lotCommands = formed.rows.filter((row) => row.command.tool === 'propose_lot')
    assert.equal(lotCommands.length, 1)
    assert.ok(!('estimated_quantity' in lotCommands[0].command))
  },
)

test(
  'a retained /6 lead keeps queueing /6 successors after its worker restarts with the switch on',
  { timeout: 240000 },
  async (t) => {
    const own = ownedResources(t)
    const fixture = await processingFixture({ profileId: 'synthetic-session/1' })
    own(() => fixture.dispose())
    const root = await workerRoot()
    own(() => rm(root, { recursive: true, force: true }))
    const capture = await fixture.seedCapture()
    const batchId = capture.batch.id
    await notedPhoto(fixture, batchId, 'Tray', '16 MHz crystal')
    const before = await startWorker(fixture, root, false)
    own(() => before.stop())
    await before.until(
      () => successors(fixture, batchId, '16 mhz crystal'),
      (found) => found.length === 2 && found.every((row) => row.sessionState === 'waiting_input'),
      'the `/6` lead’s successors run and wait for their answers',
    )
    assert.equal(await leadVersion(fixture, batchId), 'bench-intake-input/6')
    // A `/6` lead and its lot sessions keep publishing `/5` proposals.
    assert.deepEqual(await publishedKinds(fixture, batchId, 'examine'), ['bench-intake-proposal/5'])
    assert.deepEqual(await publishedKinds(fixture, batchId, 'research'), [
      'bench-intake-proposal/5',
    ])
    await before.stop()

    // The worker comes back with the switch on, and new evidence reaches the retained lead.
    fixture.config.stageInputs = 'local'
    await notedPhoto(fixture, batchId, 'Bag', '10k resistor')
    const after = await startWorker(fixture, root, true)
    own(() => after.stop())
    const queued = await after.until(
      () => successors(fixture, batchId, '10k resistor'),
      (found) => found.length === 2,
      'the retained lead queues the new lot’s successors',
    )
    assert.equal(await leadVersion(fixture, batchId), 'bench-intake-input/6')
    assert.deepEqual(
      queued.map((row) => [row.stage, row.version]),
      [
        ['images', 'bench-intake-input/6'],
        ['research', 'bench-intake-input/6'],
      ],
    )
  },
)

test(
  'a worker paired to the VM bridge refuses the switch before it touches any session',
  { timeout: 120000 },
  async (t) => {
    const own = ownedResources(t)
    const fixture = await processingFixture({ profileId: 'synthetic-session/1' })
    own(() => fixture.dispose())
    const capture = await fixture.seedCapture()
    await notedPhoto(fixture, capture.batch.id, 'Tray', '16 MHz crystal')
    const root = await workerRoot()
    own(() => rm(root, { recursive: true, force: true }))
    // The pairing names a bridge the worker would start; the switch is refused first.
    const worker = await startWorker(fixture, root, true, {
      INTAKE_VM_PAIR: join(root, 'pair'),
      INTAKE_VM_PORT: '45999',
    })
    own(() => worker.stop())
    const { code, output } = await worker.exit()
    assert.equal(code, 1)
    assert.match(output, /session_agent_configuration_required/)
    // Nothing was recovered, queued or started for the batch.
    const jobs = await fixture.db.pool.query('SELECT 1 FROM processing_job WHERE batch_id=$1', [
      capture.batch.id,
    ])
    assert.equal(jobs.rowCount, 0)

    // The control: the same pairing without the switch gets past that check to the bridge,
    // which this unpaired fixture can't start, so it stops for another reason.
    const control = await startWorker(fixture, root, false, {
      INTAKE_VM_PAIR: join(root, 'pair'),
      INTAKE_VM_PORT: '45999',
    })
    own(() => control.stop())
    const unpaired = await control.exit()
    assert.equal(unpaired.code, 1)
    assert.doesNotMatch(unpaired.output, /session_agent_configuration_required/)
  },
)
