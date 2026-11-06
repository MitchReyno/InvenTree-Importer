import { randomUUID } from 'node:crypto'
import type { Pool } from 'pg'
import { and, eq, sql } from 'drizzle-orm'
import { executeDatabaseQuery, queryDatabase, transaction } from '../db/database.ts'
import { appendEvent } from '../db/authority.ts'
import { captureBatches } from '../capture/schema.ts'
import { CaptureError, captureInTransaction } from '../capture/repository.ts'
import { lockBatchMediaInputs } from '../media/locked-inputs.ts'
import { readAgentSettings } from '../agents/settings.ts'
import { appendSessionInbox } from '../agents/tools/inbox.ts'
import type { ProcessingConfig } from './attempts.ts'
import { processingJobs } from './schema.ts'
import { createSessionAttempt } from './session-attempts.ts'
import { isSessionProfile, type SessionProfileId } from './session-policy.ts'

/** Evidence must have stopped becoming ready for this long before the lead session looks. */
export const EXAMINE_QUIET_PERIOD_MS = 20_000

interface Candidate {
  batch_id: string
  stream_id: string
  lead_job_id: string | null
  /** Changes whenever evidence becomes ready, so a skipped batch is retried after new evidence. */
  signature: string
}

/**
 * Batches in this worker's account whose ready originals are not yet covered by an evidence
 * observation or an evidence notice, once no evidence has become ready for the quiet period.
 */
async function candidates(pool: Pool, config: ProcessingConfig, quietMs: number) {
  const rows = await pool.query<Candidate>(
    `SELECT b.id AS batch_id, b.stream_id,
       (SELECT j.id FROM public.processing_job j WHERE j.batch_id=b.id AND j.stage='examine') AS lead_job_id,
       (SELECT count(*)::text || ':' || coalesce(max(r.created_at)::text,'') FROM public.media_version v
         JOIN public.media_decode_command c ON c.version_id=v.id AND c.derivation_id IS NULL
         JOIN public.media_decode_result r ON r.command_id=c.id
         WHERE v.batch_id=b.id) AS signature
     FROM public.capture_batch b
     WHERE b.actor_id=$1 AND b.target_id=$2 AND b.target_context_id=$3 AND NOT b.archived
       AND EXISTS (SELECT 1 FROM public.media_version v
         JOIN public.media_decode_command c ON c.version_id=v.id AND c.derivation_id IS NULL
         JOIN public.media_decode_result r ON r.command_id=c.id AND r.state='ready'
         WHERE v.batch_id=b.id AND v.kind='original'
           AND NOT EXISTS (SELECT 1 FROM public.capture_evidence_observation o WHERE o.evidence_version_id=v.id)
           AND NOT EXISTS (SELECT 1 FROM public.agent_session_inbox i
             JOIN public.processing_job lj ON lj.id=i.session_lineage_id AND lj.stage='examine'
             WHERE lj.batch_id=b.id AND i.kind='evidence' AND i.payload->>'version_id'=v.id::text)
           AND NOT EXISTS (SELECT 1 FROM public.media_command_pin p
             JOIN public.processing_attempt a ON a.command_id=p.command_id
             JOIN public.processing_job lj ON lj.id=a.job_id AND lj.stage='examine'
             WHERE lj.batch_id=b.id AND p.version_id=v.id))
       AND (SELECT max(r.created_at) FROM public.media_version v
         JOIN public.media_decode_command c ON c.version_id=v.id AND c.derivation_id IS NULL
         JOIN public.media_decode_result r ON r.command_id=c.id
         WHERE v.batch_id=b.id) <= now() - make_interval(secs => $4::double precision / 1000)
     ORDER BY b.updated_at, b.id
     LIMIT 50`,
    [config.actorId, config.targetId, config.targetContextId, quietMs],
  )
  return rows.rows
}

async function uncoveredVersions(
  pool: Pool | import('pg').PoolClient,
  batchId: string,
  leadJobId: string,
) {
  const rows = await pool.query<{ evidence_id: string; version_id: string }>(
    `SELECT v.evidence_id, v.id AS version_id FROM public.media_version v
     JOIN public.media_decode_command c ON c.version_id=v.id AND c.derivation_id IS NULL
     JOIN public.media_decode_result r ON r.command_id=c.id AND r.state='ready'
     WHERE v.batch_id=$1 AND v.kind='original'
       AND NOT EXISTS (SELECT 1 FROM public.capture_evidence_observation o WHERE o.evidence_version_id=v.id)
       AND NOT EXISTS (SELECT 1 FROM public.agent_session_inbox i
         WHERE i.session_lineage_id=$2 AND i.kind='evidence' AND i.payload->>'version_id'=v.id::text)
       -- Evidence pinned for any of the lead job's attempts was in its opening manifest.
       AND NOT EXISTS (SELECT 1 FROM public.media_command_pin p
         JOIN public.processing_attempt a ON a.command_id=p.command_id
         WHERE a.job_id=$2 AND p.version_id=v.id)
     ORDER BY v.created_at, v.id`,
    [batchId, leadJobId],
  )
  return rows.rows
}

/**
 * One sweep of the Examine trigger, on the `agent_writer` pool. A batch with no lead job gets one
 * (the partial unique index keeps it single); an existing lead session gets an evidence notice
 * per new ready original, and the session wake sweep resumes it. Each batch has its own
 * transaction, so publication stays last.
 */
export async function triggerExamine(
  pool: Pool,
  config: ProcessingConfig,
  {
    quietMs = EXAMINE_QUIET_PERIOD_MS,
    skipped = new Map<string, string>(),
  }: {
    quietMs?: number
    /** Batches that failed, by evidence signature; the worker keeps one map across sweeps. */
    skipped?: Map<string, string>
  } = {},
) {
  const profileId = config.profileId
  if (!profileId || !isSessionProfile(profileId)) {
    return { created: [] as string[], notified: [] as string[], failed: [] as string[] }
  }
  const created: string[] = []
  const notified: string[] = []
  const failed: string[] = []
  for (const candidate of await candidates(pool, config, quietMs)) {
    if (skipped.get(candidate.batch_id) === candidate.signature) {
      continue
    }
    await transaction(pool, async (client) => {
      const capture = await captureInTransaction(client, config, candidate.batch_id, true)
      if (capture.snapshot.archived) {
        return
      }
      const existing = await executeDatabaseQuery(
        queryDatabase(client)
          .select({ id: processingJobs.id })
          .from(processingJobs)
          .where(
            and(
              eq(processingJobs.batchId, candidate.batch_id),
              sql`${processingJobs.stage}='examine'`,
            ),
          )
          .for('update'),
      )
      if (existing[0]) {
        for (const version of await uncoveredVersions(client, candidate.batch_id, existing[0].id)) {
          await appendSessionInbox(
            client,
            {
              binding: config,
              batchId: candidate.batch_id,
              lineageId: existing[0].id,
              actorId: null,
              idempotencyKey: version.version_id,
              kind: 'evidence',
              payload: { evidence_id: version.evidence_id, version_id: version.version_id },
            },
            { publish: false },
          )
          notified.push(version.version_id)
        }
      } else {
        if (profileId === 'native-agent/2') {
          // No saved agent default: the lead session waits until the operator chooses one.
          const settings = await readAgentSettings(client, config)
          if (!settings.selection) {
            return
          }
        }
        const media = await lockBatchMediaInputs(client, config, candidate.batch_id)
        if (!media.versions.length) {
          return
        }
        const jobId = randomUUID()
        const attempt = await createSessionAttempt(
          client,
          config,
          profileId as SessionProfileId,
          capture.snapshot,
          { id: jobId, subject_id: null, stage: 'examine' },
          '1',
          media,
          null,
          { lockSettings: false },
        )
        await executeDatabaseQuery(
          queryDatabase(client).insert(processingJobs).values({
            id: jobId,
            batchId: candidate.batch_id,
            subjectId: null,
            stage: 'examine',
            currentAttemptId: attempt.attemptId,
            state: 'queued',
          }),
        )
        created.push(jobId)
      }
      const streams = await executeDatabaseQuery(
        queryDatabase(client)
          .select({ streamId: captureBatches.streamId })
          .from(captureBatches)
          .where(eq(captureBatches.id, candidate.batch_id)),
      )
      await appendEvent(client, streams[0].streamId, 'processing_changed', {
        batch_id: candidate.batch_id,
      })
    }).catch((error: unknown) => {
      // A concurrent sweep created the lead job first; the next sweep sees it.
      if ((error as { code?: string }).code === '23505') {
        return
      }
      // One batch never stops the others: it is skipped until its evidence changes.
      skipped.set(candidate.batch_id, candidate.signature)
      failed.push(candidate.batch_id)
      // Only known codes are logged; anything else could carry data.
      const code = error instanceof CaptureError ? error.code : 'examine_trigger_failed'
      process.stderr.write(
        JSON.stringify({ event: 'examine_trigger_skipped', batch_id: candidate.batch_id, code }) +
          '\n',
      )
    })
  }
  return { created, notified, failed }
}
