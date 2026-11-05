import { randomUUID } from 'node:crypto'
import type { processingFixture } from './processing.ts'
import { sealed } from '../../src/processing/model.ts'
import { transaction } from '../../src/db/database.ts'
import { resolveMediaInputs } from '../../src/media/inputs.ts'
import { sessionLotInputManifest } from '../../src/processing/session-input.ts'

type Fixture = Awaited<ReturnType<typeof processingFixture>>
type Capture = Awaited<ReturnType<Fixture['seedCapture']>>

/** A research session for one lot, seeded as the migration owner. */
export async function lotSession(
  fixture: Fixture,
  capture: Capture,
  lot: { id: string },
  options: {
    state?: 'running' | 'queued'
    profile?: Parameters<typeof sessionLotInputManifest>[4]
  } = {},
) {
  const state = options.state ?? 'running'
  const profile = options.profile ?? { id: 'synthetic-session/1' as const }
  const ids = {
    job: randomUUID(),
    attempt: randomUUID(),
    input: randomUUID(),
    command: randomUUID(),
  }
  return transaction(fixture.db.pool, async (client) => {
    const media = await resolveMediaInputs(client, fixture.config, capture.batch.id, [lot.id])
    const manifest = sessionLotInputManifest(
      capture.batch,
      lot.id,
      'research',
      { manifest: media.bytes.toString('utf8'), sha256: media.digest.toString('hex') },
      profile,
    )
    const input = sealed(manifest)
    const command = sealed({ fixture: 'session-tools-command', attempt_id: ids.attempt })
    await client.query(
      'INSERT INTO processing_input(id,batch_id,capture_revision,manifest_bytes,manifest_digest) VALUES($1,$2,$3,$4,$5)',
      [ids.input, capture.batch.id, capture.batch.revision, input.bytes, input.digest],
    )
    await client.query(
      `INSERT INTO command(id,actor_id,target_id,target_context_id,kind,handler_version,workflow_id,queue_name,payload_bytes,payload_digest)
       VALUES($1,$2,$3,$4,'process','processing/5',$5,'bench-sessions',$6,$7)`,
      [
        ids.command,
        fixture.identity.actor,
        fixture.identity.target,
        fixture.identity.context,
        `processing:${ids.attempt}`,
        command.bytes,
        command.digest,
      ],
    )
    await client.query(
      "INSERT INTO processing_job(id,batch_id,subject_id,stage,current_attempt_id,state) VALUES($1,$2,$3,'research',$4,$5)",
      [ids.job, capture.batch.id, lot.id, ids.attempt, state],
    )
    await client.query(
      `INSERT INTO processing_attempt(id,batch_id,job_id,number,input_id,profile_id,command_id,channel_digest,state)
       VALUES($1,$2,$3,1,$4,$5,$6,$7,$8)`,
      [
        ids.attempt,
        capture.batch.id,
        ids.job,
        ids.input,
        profile.id,
        ids.command,
        input.digest,
        state,
      ],
    )
    await client.query(
      'INSERT INTO agent_session(attempt_id,session_state,session_lineage_id) VALUES($1,$2,$3)',
      [ids.attempt, state, ids.job],
    )
    return { ...ids, manifest }
  })
}
