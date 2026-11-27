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
import { mediaEditor } from '../support/media-removal.ts'
import { grantMedia } from '#/media/grants.ts'

test(
  'the session worker’s Examine lead never sees a removed photo, and examines it once restored',
  { timeout: 150000 },
  async (t) => {
    const fixture = await processingFixture({ profileId: 'synthetic-session/1' })
    t.after(() => fixture.dispose())
    await grantMedia(fixture.db.pool, fixture.api.name, 'api')
    const capture = await fixture.seedCapture()
    const batchId = capture.batch.id
    // Ready a minute ago, so the Examine quiet period has passed.
    const removed = await seedPhoto(fixture, batchId, { width: 768, height: 512 }, 'Reel', 60)
    const kept = await seedPhoto(fixture, batchId, { width: 768, height: 512 }, 'Tray', 60)
    for (const [photo, text] of [
      [removed, 'LED 0603 red'],
      [kept, '16 MHz crystal'],
    ] as const) {
      await fixture.db.pool.query(
        'INSERT INTO media_evidence_note(id,batch_id,evidence_id,revision,text,actor_id) VALUES($1,$2,$3,1,$4,$5)',
        [randomUUID(), batchId, photo.evidence, text, fixture.identity.actor],
      )
    }
    const media = mediaEditor(fixture.api.pool, fixture.config, batchId)
    await media.applied({ kind: 'remove', evidence_ids: [removed.evidence] })

    const root = await mkdtemp(join(tmpdir(), 'removal-worker-test-'))
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
      const deadline = Date.now() + 60000
      let value = await read()
      while (!done(value) && Date.now() < deadline && worker.exitCode === null) {
        await delay(250)
        value = await read()
      }
      assert.ok(done(value), `${label}: ${JSON.stringify(value)}\n${output}`)
      return value
    }
    const observedVersions = async () =>
      (
        await fixture.db.pool.query<{ version: string }>(
          'SELECT DISTINCT evidence_version_id AS version FROM capture_evidence_observation WHERE batch_id=$1',
          [batchId],
        )
      ).rows.map((row) => row.version)
    const leadState = async () =>
      (
        await fixture.db.pool.query<{ session_state: string | null; manifest: string }>(
          `SELECT s.session_state, convert_from(i.manifest_bytes,'UTF8') AS manifest
           FROM processing_job j JOIN processing_attempt a ON a.id=j.current_attempt_id
           JOIN agent_session s ON s.attempt_id=a.id JOIN processing_input i ON i.id=a.input_id
           WHERE j.batch_id=$1 AND j.stage='examine'`,
          [batchId],
        )
      ).rows[0]

    const finished = await until(
      leadState,
      (lead) => lead?.session_state === 'finished',
      'the lead session runs once',
    )
    assert.ok(finished.manifest.includes(kept.version))
    assert.ok(!finished.manifest.includes(removed.version), 'the removed photo is not pinned')
    assert.deepEqual(await observedVersions(), [kept.version])
    const notices = await fixture.db.pool.query(
      "SELECT 1 FROM agent_session_inbox WHERE kind='evidence' AND payload->>'version_id'=$1",
      [removed.version],
    )
    assert.equal(notices.rowCount, 0, 'no evidence notice names the removed photo')

    // Restored, it reaches the lead as new evidence, which the wake sweep examines.
    await media.applied({ kind: 'restore', evidence_ids: [removed.evidence] })
    await until(
      observedVersions,
      (versions) => versions.includes(removed.version),
      'the restored photo is examined',
    )
  },
)
