import { createHash, randomUUID } from 'node:crypto'
import type { processingFixture } from './processing.ts'
import { processingSubjectScope, sealed } from '#/processing/model.ts'
import { transaction } from '#/db/database.ts'
import { resolveMediaInputs } from '#/media/inputs.ts'
import { sessionInputV6, sessionLotInputManifest } from '#/processing/session-input.ts'

/** A lot session's `/6` input, as the fixtures seal it. */
function lotInputV6(...args: Parameters<typeof sessionLotInputManifest>) {
  return sessionInputV6(sessionLotInputManifest(...args))
}
import type { CaptureBinding } from '#/capture/model.ts'

type ProcessingFixture = Awaited<ReturnType<typeof processingFixture>>
/** What the session helpers use, so the processing and manual fixtures both fit. */
type Fixture = Pick<ProcessingFixture, 'db' | 'identity'> & { config: CaptureBinding }
type SeededCapture = Awaited<ReturnType<ProcessingFixture['seedCapture']>>
type Capture = Pick<SeededCapture, 'batch' | 'packetA'>

/** A research session for one lot, seeded as the migration owner. */
export async function lotSession(
  fixture: Fixture,
  capture: Capture,
  lot: { id: string },
  options: {
    state?: 'running' | 'queued'
    profile?: Parameters<typeof sessionLotInputManifest>[4]
    stage?: 'research' | 'images'
  } = {},
) {
  const state = options.state ?? 'running'
  const stage = options.stage ?? 'research'
  const profile = options.profile ?? { id: 'synthetic-session/1' as const }
  const ids = {
    job: randomUUID(),
    attempt: randomUUID(),
    input: randomUUID(),
    command: randomUUID(),
  }
  return transaction(fixture.db.pool, async (client) => {
    // A lot linked to a shared Part takes the Part's media scope too.
    const media = await resolveMediaInputs(
      client,
      fixture.config,
      capture.batch.id,
      processingSubjectScope(capture.batch, lot.id),
    )
    const manifest = lotInputV6(
      capture.batch,
      lot.id,
      stage,
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
      'INSERT INTO processing_job(id,batch_id,subject_id,stage,current_attempt_id,state) VALUES($1,$2,$3,$4,$5,$6)',
      [ids.job, capture.batch.id, lot.id, stage, ids.attempt, state],
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
export async function leadSession(
  fixture: Fixture,
  capture: Capture,
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
  await transaction(fixture.db.pool, async (client) => {
    // A lot manifest switched to the batch-level Examine scope; batch-scoped media pinning is
    // the lead job's own concern.
    const media = await resolveMediaInputs(
      client,
      fixture.config,
      capture.batch.id,
      processingSubjectScope(capture.batch, capture.packetA.id),
    )
    const lot = lotInputV6(
      capture.batch,
      capture.packetA.id,
      'research',
      { manifest: media.bytes.toString('utf8'), sha256: media.digest.toString('hex') },
      profile,
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
      "INSERT INTO processing_job(id,batch_id,subject_id,stage,current_attempt_id,state) VALUES($1,$2,NULL,'examine',$3,$4)",
      [ids.job, capture.batch.id, ids.attempt, state],
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
  })
  return ids
}

/** The `/1` ask shape sessions sent before stepped questions. */
export interface LegacyAsk {
  kind: 'quantity' | 'clarification'
  subject_id: string | null
  prompt: string
  reason: string
  fields: string[]
  assumption: string
}

/** A `/1` ask as the one-step `/2` question the `ask` tool now takes. */
export function oneStepAsk(ask: LegacyAsk) {
  return {
    schema_version: 'bench-intake-question/2',
    subject_id: ask.subject_id,
    reason: ask.reason,
    fields: ask.fields,
    steps: [
      {
        id: 'answer',
        prompt: ask.prompt,
        assumption: ask.assumption,
        answer: { kind: ask.kind === 'quantity' ? 'number' : 'text' },
      },
    ],
  }
}

/**
 * A `/1` session question retained before stepped questions existed, stored as the earlier `ask`
 * handler stored it: the sealed envelope, the question row and its outbox item.
 */
export async function legacySessionQuestion(
  fixture: Fixture,
  session: { job: string; attempt: string; input: string; command: string },
  ask: LegacyAsk,
) {
  return transaction(fixture.db.pool, async (client) => {
    const attempt = await client.query<{
      batch_id: string
      last_sequence: string
      manifest_digest: Buffer
    }>(
      `SELECT a.batch_id, a.last_sequence::text, i.manifest_digest FROM processing_attempt a
       JOIN processing_input i ON i.id=a.input_id WHERE a.id=$1`,
      [session.attempt],
    )
    const {
      batch_id: batchId,
      last_sequence: lastSequence,
      manifest_digest: digest,
    } = attempt.rows[0]
    const sequence = (BigInt(lastSequence) + 1n).toString()
    const envelope = sealed({
      schema_version: 'bench-intake-session/1',
      job_id: session.job,
      attempt_id: session.attempt,
      command_id: session.command,
      input_sha256: digest.toString('hex'),
      sequence,
      kind: 'question',
      payload: ask,
    })
    const messageId = randomUUID()
    await client.query(
      `INSERT INTO processing_message(id,attempt_id,sequence,envelope_bytes,envelope_digest,disposition)
       VALUES($1,$2,$3,$4,$5,'accepted')`,
      [messageId, session.attempt, sequence, envelope.bytes, envelope.digest],
    )
    await client.query('UPDATE processing_attempt SET last_sequence=$2 WHERE id=$1', [
      session.attempt,
      sequence,
    ])
    const spec = sealed(ask)
    const questionId = randomUUID()
    await client.query(
      `INSERT INTO processing_question(id,batch_id,job_id,attempt_id,message_id,input_id,state,spec_bytes,spec_digest)
       VALUES($1,$2,$3,$4,$5,$6,'open',$7,$8)`,
      [
        questionId,
        batchId,
        session.job,
        session.attempt,
        messageId,
        session.input,
        spec.bytes,
        spec.digest,
      ],
    )
    return questionId
  })
}

/** Another attempt of the job, sealed as a session attempt would be, now its current one. */
export async function nextSessionAttempt(
  fixture: Fixture,
  capture: Capture,
  session: { job: string },
  lot: { id: string },
  number: number,
  profile: Parameters<typeof sessionLotInputManifest>[4],
  state: 'running' | 'queued' = 'running',
  /** False for an attempt of a profile without sessions, which has no session row. */
  withSession = true,
) {
  const ids = { attempt: randomUUID(), input: randomUUID(), command: randomUUID() }
  await transaction(fixture.db.pool, async (client) => {
    const media = await resolveMediaInputs(
      client,
      fixture.config,
      capture.batch.id,
      processingSubjectScope(capture.batch, lot.id),
    )
    const manifest = lotInputV6(
      capture.batch,
      lot.id,
      'research',
      { manifest: media.bytes.toString('utf8'), sha256: media.digest.toString('hex') },
      profile,
    )
    const input = sealed(manifest)
    const command = sealed({ fixture: 'history-attempt', attempt_id: ids.attempt })
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
      `INSERT INTO processing_attempt(id,batch_id,job_id,number,input_id,profile_id,command_id,channel_digest,state)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [
        ids.attempt,
        capture.batch.id,
        session.job,
        number,
        ids.input,
        profile.id,
        ids.command,
        input.digest,
        state,
      ],
    )
    if (withSession) {
      await client.query(
        'INSERT INTO agent_session(attempt_id,session_state,session_lineage_id) VALUES($1,$2,$3)',
        [ids.attempt, state, session.job],
      )
    }
    await client.query('UPDATE processing_job SET current_attempt_id=$2, state=$3 WHERE id=$1', [
      session.job,
      ids.attempt,
      state,
    ])
  })
  return ids
}
