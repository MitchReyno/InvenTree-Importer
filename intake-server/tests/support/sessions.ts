import { createHash, randomUUID } from 'node:crypto'
import type { processingFixture } from './processing.ts'
import { sealed } from '#/processing/model.ts'
import { transaction } from '#/db/database.ts'
import { resolveMediaInputs } from '#/media/inputs.ts'
import { sessionLotInputManifest } from '#/processing/session-input.ts'

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

/** A ready photo whose preview has the given size, as the decoder would leave it. */
export async function seedPhoto(
  fixture: Fixture,
  batchId: string,
  size: { width: number; height: number },
  label = 'Photo',
  /** How long ago decoding finished; the Examine quiet period counts from it. */
  readySecondsAgo = 0,
  content?: { original: Buffer; preview: Buffer },
) {
  const ids = { evidence: randomUUID(), version: randomUUID(), decode: randomUUID() }
  const digest = createHash('sha256')
    .update(content?.original ?? ids.version)
    .digest()
  const previewDigest = content ? createHash('sha256').update(content.preview).digest() : digest
  await transaction(fixture.db.pool, async (client) => {
    await client.query('INSERT INTO media_batch(batch_id) VALUES($1) ON CONFLICT DO NOTHING', [
      batchId,
    ])
    await client.query(
      'INSERT INTO media_blob(digest,byte_size) VALUES($1,$2) ON CONFLICT DO NOTHING',
      [digest, content?.original.length.toString() ?? '64'],
    )
    if (content) {
      await client.query(
        'INSERT INTO media_blob(digest,byte_size) VALUES($1,$2) ON CONFLICT DO NOTHING',
        [previewDigest, content.preview.length.toString()],
      )
    }
    await client.query(
      'INSERT INTO media_evidence(id,batch_id,label,actor_id) VALUES($1,$2,$3,$4)',
      [ids.evidence, batchId, label, fixture.identity.actor],
    )
    await client.query(
      `INSERT INTO media_version(id,batch_id,evidence_id,kind,blob_digest,media_type,actor_id)
       VALUES($1,$2,$3,'original',$4,'image/png',$5)`,
      [ids.version, batchId, ids.evidence, digest, fixture.identity.actor],
    )
    await client.query(
      "INSERT INTO media_decode_command(id,batch_id,version_id,build) VALUES($1,$2,$3,'observation-fixture/1')",
      [ids.decode, batchId, ids.version],
    )
    await client.query(
      `INSERT INTO media_decode_result(command_id,state,decoder_build,created_at)
       VALUES($1,'ready','observation-fixture/1',now()-make_interval(secs => $2))`,
      [ids.decode, readySecondsAgo],
    )
    await client.query(
      `INSERT INTO media_preview(id,batch_id,version_id,command_id,page,width,height,blob_digest)
       VALUES($1,$2,$3,$4,1,$5,$6,$7)`,
      [randomUUID(), batchId, ids.version, ids.decode, size.width, size.height, previewDigest],
    )
  })
  return ids
}

/** The batch's Examine lead session: a batch-scoped job with no subject. */
export async function leadSession(fixture: Fixture, capture: Capture) {
  const ids = {
    job: randomUUID(),
    attempt: randomUUID(),
    input: randomUUID(),
    command: randomUUID(),
  }
  await transaction(fixture.db.pool, async (client) => {
    // A lot manifest switched to the batch-level Examine scope; batch-scoped media pinning is
    // the lead job's own concern.
    const media = await resolveMediaInputs(client, fixture.config, capture.batch.id, [
      capture.packetA.id,
    ])
    const lot = sessionLotInputManifest(
      capture.batch,
      capture.packetA.id,
      'research',
      { manifest: media.bytes.toString('utf8'), sha256: media.digest.toString('hex') },
      { id: 'synthetic-session/1' },
    )
    const input = sealed({
      ...lot,
      stage: 'examine',
      subject_id: null,
      subject: null,
      linked_part: null,
    })
    const command = sealed({ fixture: 'lead-session-command', attempt_id: ids.attempt })
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
      "INSERT INTO processing_job(id,batch_id,subject_id,stage,current_attempt_id,state) VALUES($1,$2,NULL,'examine',$3,'running')",
      [ids.job, capture.batch.id, ids.attempt],
    )
    await client.query(
      `INSERT INTO processing_attempt(id,batch_id,job_id,number,input_id,profile_id,command_id,channel_digest,state)
       VALUES($1,$2,$3,1,$4,'synthetic-session/1',$5,$6,'running')`,
      [ids.attempt, capture.batch.id, ids.job, ids.input, ids.command, input.digest],
    )
    await client.query(
      "INSERT INTO agent_session(attempt_id,session_state,session_lineage_id) VALUES($1,'running',$2)",
      [ids.attempt, ids.job],
    )
  })
  return ids
}
