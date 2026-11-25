import { NativeSessionError, sessionFailure } from '#/agents/failure-model.ts'
import { retainSessionFailure } from '#/agents/failures.ts'
import type { SessionFailureDto } from '@invimport/contracts'
import { pinnedIdentityCurrent, successorsCurrent } from '#/processing/stable-identity.ts'
import { supersedeJobAttempts } from '#/processing/jobs.ts'
import { join } from 'node:path'
import { and, eq, inArray, notExists, or, sql } from 'drizzle-orm'
import type { Pool, PoolClient } from 'pg'
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client'
import type { ProcessingInputV7Dto, SessionInputDto, SessionStateDto } from '@invimport/contracts'
import { executeDatabaseQuery, queryDatabase, transaction } from '#/db/database.ts'
import { appendEvent, sha256 } from '#/db/authority.ts'
import type { ProcessingConfig } from '#/processing/attempts.ts'
import { captureBatches } from '#/capture/schema.ts'
import { commands } from '#/db/schema.ts'
import {
  processingAttempts,
  processingInputs,
  processingProfileRecords,
  processingQuestions,
} from '#/processing/schema.ts'
import { lockProcessingAttempt, transitionAttempt } from '#/processing/state.ts'
import { withoutRemovedMedia } from '#/processing/brief-removal.ts'
import { decodeSessionInput } from '#/processing/session-input.ts'
import { webAccess } from '#/processing/session-policy.ts'
import { expectedToolProfile } from '#/processing/stage-policy.ts'
import { openingBrief, pageToken } from '#/processing/brief-pages.ts'
import { fail } from '#/processing/model.ts'
import { evidenceNotes } from '#/capture/context-input.ts'
import { decodeMediaInputs } from '#/media/inputs.ts'
import { agentBatchPauses, agentSessionInbox, agentSessions, agentSlots } from '#/agents/schema.ts'
import { agentEnvironment, privateDirectory, type NativeAgentHost } from '#/agents/environment.ts'
import { recordSessionProgress } from './sessions.ts'
import {
  requireSupervisorFence,
  SupervisorLockLostError,
  type SupervisorFence,
} from '#/agents/supervisor-fence.ts'
import { issueSessionCapability, revokeSessionCapability } from '#/agents/tools/capability.ts'
import {
  acknowledgeSessionInbox,
  deliverableInboxItem,
  lockInboxBatch,
  pendingSessionInbox,
  releaseInboxItems,
} from '#/agents/tools/inbox.ts'
import { ASK_GUIDANCE } from '#/agents/tools/ask-guidance.ts'
import { syntheticTurn } from './synthetic-turn.ts'
import {
  claimSessionSlot,
  recordSlotTurn,
  recordTurnChild,
  releaseSessionSlot,
  type TurnChild,
} from './slots.ts'
import {
  runClaudeSession,
  runCodexSession,
  SessionResumeUnavailable,
  type SessionTurn,
} from './session-adapters.ts'
import { ResearchReapPendingError } from '#/research/errors.ts'

/** Tools every session gets; the lot-forming tools are added for the Examine lead session. */
const SLOT_WAIT_MS = 500
const SLOT_WAIT_LIMIT_MS = 30_000
const CANCEL_POLL_MS = 500

export const SESSION_TOOLS = ['ask', 'fetch_evidence', 'propose', 'read_inbox', 'reply', 'status']
/** The batch's Examine lead session also forms lots. */
export const LEAD_SESSION_TOOLS = [
  ...SESSION_TOOLS,
  'propose_lot',
  'read_batch',
  'record_observation',
  'regroup',
]
/** A `/7` Research or Images session also reads its lot's brief. */
export const STAGE_LOT_SESSION_TOOLS = [...SESSION_TOOLS, 'read_lot']

/** The intake tools a session is offered, from its sealed input. */
export function sessionToolNames(manifest: SessionInputDto) {
  if (manifest.stage === 'examine') {
    return LEAD_SESSION_TOOLS
  }
  return manifest.schema_version === 'bench-intake-input/7'
    ? STAGE_LOT_SESSION_TOOLS
    : SESSION_TOOLS
}

const LEAD_INSTRUCTIONS = [
  'You are this batch’s Examine lead session: find the items in the evidence, group them into lots and identify each lot, looping until the lots are stable.',
  'Fetch each photo with fetch_evidence. Whole photos can arrive at original size; give regions in the page sizes it returns. A photo can hold several items, and one item can appear in several photos.',
  'Record each item you see with record_observation: one region per item, with its markings and any visible count. Say in its readings what the markings were read from (source_kind) and how sure you are (agreement).',
  'Group observations of the same physical thing with propose_lot: the front and back of one packet are one lot; the same part number with different date codes are separate lots that may share one Part.',
  'Publish markings, identity and quantity for each lot with propose. A quantity is an estimate with its basis; never add up photos of the same items, and count an observation with same_item_as once with the one it names.',
  'An identity relies on the lot’s current observation set: cite it in relies_on as {kind: "observation_set", lot_id, version} with the observation_set_version read_batch returns. That makes the identity stable, which starts the lot’s Research and Images; after you regroup a lot, publish its identity again.',
  'Call read_batch for the current lots, Parts and observations. Pass the revision from your last tool response as base_revision. On a stale result, read_batch again and re-plan. Lots and observations the operator edited only accept suggestions; a response with suggested: true changed nothing else.',
  'Evidence notes and groups are hints, not lot boundaries. When new evidence arrives in the inbox, examine only that evidence.',
].join(' ')

type AttemptState = Parameters<typeof transitionAttempt>[3]
const attemptStateFor: Record<SessionStateDto, AttemptState> = {
  queued: 'queued',
  running: 'running',
  waiting_input: 'waiting_for_user',
  finished: 'ready',
  cancelling: 'running',
  cancelled: 'cancelled',
  interrupted: 'interrupted',
  failed: 'failed',
  waiting_for_login: 'waiting_for_login',
  waiting_for_capacity: 'waiting_for_capacity',
  resume_unavailable: 'interrupted',
}
/** States a new inbox item resumes. Running sessions receive it in turn instead. */
const RESUMABLE: SessionStateDto[] = ['waiting_input', 'finished', 'interrupted']

export interface SessionDriverContext {
  identity: { attemptId: string; turn: string; lineage: string }
  manifest: SessionInputDto
  cwd: string
  signal: AbortSignal
  /**
   * Commits what the turn is about to start outside its worker, before starting it, so a restart
   * can confirm it gone. The runner provides it; a guest-side context has none.
   */
  recordChild?: (child: TurnChild) => Promise<void>
}
export type SessionDriver = (turn: SessionTurn, context: SessionDriverContext) => Promise<void>

export interface SessionRunnerDeps {
  pool: Pool
  config: ProcessingConfig
  host: NativeAgentHost
  toolUrl: string
  /** Replaces the provider for a profile, for the synthetic profile and process tests. */
  drivers?: Partial<Record<SessionInputDto['profile_id'], SessionDriver>>
  /** Overrides the per-turn deadline, for tests. */
  turnDeadlineMs?: number
  /** The worker's supervisor fence; every worker passes it, tests without a supervisor omit it. */
  fence?: SupervisorFence
  /** Overrides `SETTLEMENT_FENCE_RETRY_MS`, for tests. */
  settlementFenceRetryMs?: number
}

/** A turn longer than this is stopped and reaped; the session fails rather than resuming a stall. */
export const SESSION_TURN_DEADLINE_MS = 15 * 60 * 1000

/**
 * How long a settlement the fence refused is retried: a replacement that took the lock and then
 * refused to start releases it within this, inside the worker's 30 s shutdown wait.
 */
export const SETTLEMENT_FENCE_RETRY_MS = 20_000
const SETTLEMENT_FENCE_RETRY_INTERVAL_MS = 500

/**
 * Retries a settlement while the fence refuses it; a refusal comes before it changed anything.
 * The first refusal is logged, with the attempt only.
 */
async function retryFenceRefusal<T>(
  write: () => Promise<T>,
  attemptId: string,
  boundMs: number,
): Promise<T> {
  const until = Date.now() + boundMs
  let reported = false
  for (;;) {
    try {
      return await write()
    } catch (error) {
      const retryable = error instanceof SupervisorLockLostError && Date.now() < until
      if (!retryable) {
        throw error
      }
    }
    if (!reported) {
      reported = true
      process.stderr.write(
        `${JSON.stringify({ event: 'settlement_fence_refused', attempt_id: attemptId })}\n`,
      )
    }
    await new Promise((resolve) => setTimeout(resolve, SETTLEMENT_FENCE_RETRY_INTERVAL_MS))
  }
}

/**
 * Same lock order as the tool handlers (job, attempt, then session row). With `expected`, the
 * change applies only from those states, so concurrent claims cannot both win.
 */
async function setSessionState(
  client: PoolClient,
  attemptId: string,
  jobId: string,
  requested: SessionStateDto,
  expected?: SessionStateDto[],
  { countTurn = false }: { countTurn?: boolean } = {},
): Promise<SessionStateDto | false> {
  const { job, attempt } = await lockProcessingAttempt(client, jobId, attemptId)
  // Processing owns cancellation: a cancelled or superseded attempt is never revived.
  // A replaced attempt (no longer the job's current one) is treated the same way.
  const cancelled =
    attempt.state === 'cancelled' ||
    attempt.state === 'superseded' ||
    job.current_attempt_id !== attempt.id
  const state: SessionStateDto = cancelled ? 'cancelled' : requested
  const updated = await executeDatabaseQuery(
    queryDatabase(client)
      .update(agentSessions)
      .set({
        sessionState: state,
        ...(state === 'queued' ? { queuedSince: sql`now()` } : {}),
        ...(countTurn && !cancelled ? { turnCount: sql`${agentSessions.turnCount}+1` } : {}),
      })
      .where(
        and(
          eq(agentSessions.attemptId, attemptId),
          expected ? inArray(agentSessions.sessionState, expected) : undefined,
        ),
      )
      .returning({ attemptId: agentSessions.attemptId }),
  )
  if (!updated.length) {
    return false
  }
  if (!cancelled) {
    await transitionAttempt(client, job, attempt, attemptStateFor[state])
  }
  return state
}

async function publish(client: PoolClient, batchId: string) {
  const batches = await executeDatabaseQuery(
    queryDatabase(client)
      .select({ streamId: captureBatches.streamId })
      .from(captureBatches)
      .where(eq(captureBatches.id, batchId)),
  )
  await appendEvent(client, batches[0].streamId, 'session_changed', { batch_id: batchId })
}

/** A worker start never continues a turn that was in flight; those sessions wait for a resume. */
export async function interruptRunningSessions(
  pool: Pool,
  config: ProcessingConfig,
  fence?: SupervisorFence,
) {
  // Only this worker's account: another actor's worker may be running its own sessions.
  const running = await executeDatabaseQuery(
    queryDatabase(pool)
      .select({
        attemptId: agentSessions.attemptId,
        turnCount: agentSessions.turnCount,
        jobId: processingAttempts.jobId,
        batchId: processingAttempts.batchId,
      })
      .from(agentSessions)
      .innerJoin(processingAttempts, eq(processingAttempts.id, agentSessions.attemptId))
      .innerJoin(commands, eq(commands.id, processingAttempts.commandId))
      .where(
        and(
          eq(commands.actorId, config.actorId),
          eq(commands.targetId, config.targetId),
          eq(commands.targetContextId, config.targetContextId),
          inArray(agentSessions.sessionState, ['running', 'cancelling']),
          // A session still holding a slot is not this sweep's: its turn may still be running.
          notExists(
            queryDatabase(pool)
              .select({ slot: agentSlots.slotIndex })
              .from(agentSlots)
              .where(eq(agentSlots.attemptId, agentSessions.attemptId)),
          ),
        ),
      ),
  )
  const interrupted: string[] = []
  // One transaction each, so a stream lock is only ever taken last.
  for (const session of running) {
    // The fence refused to start while any slot was held, so these slots are already clear.
    if (await transaction(pool, (client) => interruptLeftRunning(client, session, fence))) {
      interrupted.push(session.attemptId)
    }
  }
  return interrupted
}

/**
 * Interrupts a session the start sweep found running without a slot, only while this worker
 * still holds its lock and the session is still in that turn without a slot: otherwise a
 * replacement may have claimed it since.
 */
async function interruptLeftRunning(
  client: PoolClient,
  session: InterruptedSession,
  fence: SupervisorFence | undefined,
) {
  await requireSupervisorFence(client, fence, 'ownership')
  await lockProcessingAttempt(client, session.jobId, session.attemptId)
  const now = await executeDatabaseQuery(
    queryDatabase(client)
      .select({ turnCount: agentSessions.turnCount })
      .from(agentSessions)
      .where(eq(agentSessions.attemptId, session.attemptId))
      .for('update'),
  )
  const slot = await executeDatabaseQuery(
    queryDatabase(client)
      .select({ slot: agentSlots.slotIndex })
      .from(agentSlots)
      .where(eq(agentSlots.attemptId, session.attemptId)),
  )
  const sameTurnWithoutSlot = now[0]?.turnCount === session.turnCount && !slot.length
  if (!sameTurnWithoutSlot) {
    return false
  }
  return interruptSession(client, session)
}

export interface InterruptedSession {
  attemptId: string
  jobId: string
  batchId: string
  turnCount: bigint
}

/**
 * Marks one running or cancelling session interrupted, records why, revokes its capability and
 * publishes, in the caller's transaction. Returns false when it was in neither state.
 */
export async function interruptSession(client: PoolClient, session: InterruptedSession) {
  const changed = await setSessionState(client, session.attemptId, session.jobId, 'interrupted', [
    'running',
    'cancelling',
  ])
  if (!changed) {
    return false
  }
  await retainSessionFailure(
    client,
    sessionFailure(new NativeSessionError('agent_worker_interrupted'), {
      attemptId: session.attemptId,
      lineageId: session.jobId,
      turn: session.turnCount.toString(),
      stage: 'turn',
    }),
  )
  await revokeSessionCapability(client, session.attemptId)
  await publish(client, session.batchId)
  return true
}

/** Session states with no turn in flight and no slot held. */
const IDLE: SessionStateDto[] = [
  'queued',
  'waiting_input',
  'finished',
  'interrupted',
  'failed',
  'waiting_for_login',
  'resume_unavailable',
]

/**
 * Settles idle sessions whose attempt was cancelled, and queued ones whose attempt was superseded
 * before any claim. Running sessions settle through their own turn.
 */
export async function settleCancelledIdleSessions(pool: Pool, config: ProcessingConfig) {
  const stale = await executeDatabaseQuery(
    queryDatabase(pool)
      .select({
        attemptId: agentSessions.attemptId,
        jobId: processingAttempts.jobId,
        batchId: processingAttempts.batchId,
      })
      .from(agentSessions)
      .innerJoin(processingAttempts, eq(processingAttempts.id, agentSessions.attemptId))
      .innerJoin(commands, eq(commands.id, processingAttempts.commandId))
      .where(
        and(
          eq(commands.actorId, config.actorId),
          eq(commands.targetId, config.targetId),
          eq(commands.targetContextId, config.targetContextId),
          or(
            and(
              inArray(agentSessions.sessionState, IDLE),
              eq(processingAttempts.state, 'cancelled'),
            ),
            and(
              eq(agentSessions.sessionState, 'queued'),
              eq(processingAttempts.state, 'superseded'),
            ),
          ),
        ),
      ),
  )
  // One transaction each, so a stream lock is only ever taken last.
  for (const session of stale) {
    await transaction(pool, async (client) => {
      const settled = await setSessionState(
        client,
        session.attemptId,
        session.jobId,
        'cancelled',
        IDLE,
      )
      if (settled === 'cancelled') {
        await publish(client, session.batchId)
      }
    })
  }
  return stale.length
}

/**
 * Re-queues a lineage's latest session when a new inbox item arrives and it is not running.
 * Returns the attempt to wake, or undefined when nothing needs waking.
 */
export async function queueSessionResume(client: PoolClient, lineageId: string) {
  const sessions = await executeDatabaseQuery(
    queryDatabase(client)
      .select({
        attemptId: agentSessions.attemptId,
        state: agentSessions.sessionState,
        batchId: processingAttempts.batchId,
      })
      .from(agentSessions)
      .innerJoin(processingAttempts, eq(processingAttempts.id, agentSessions.attemptId))
      .where(eq(agentSessions.sessionLineageId, lineageId))
      .orderBy(sql`${processingAttempts.number} DESC`)
      .limit(1),
  )
  const session = sessions[0]
  if (!session?.state || !RESUMABLE.includes(session.state)) {
    return undefined
  }
  // The batch row orders this against an ungroup that withdraws the only pending item: with the
  // share lock held, a session with nothing left to deliver isn't woken.
  await client.query('SELECT 1 FROM public.capture_batch WHERE id=$1 FOR SHARE', [session.batchId])
  if ((await pendingSessionInbox(client, lineageId)) === 0) {
    return undefined
  }
  if (
    (await setSessionState(client, session.attemptId, lineageId, 'queued', RESUMABLE)) !== 'queued'
  ) {
    return undefined
  }
  // Kept so a wake withdrawn before its claim puts the session back as it was.
  await client.query(
    `INSERT INTO public.agent_session_resume(attempt_id,from_state) VALUES($1,$2)
     ON CONFLICT (attempt_id) DO UPDATE SET from_state=EXCLUDED.from_state`,
    [session.attemptId, session.state],
  )
  await publish(client, session.batchId)
  return session.attemptId
}

/** Aborts the turn when its attempt is no longer running, for example after a cancel. */
async function watchAttempt(pool: Pool, attemptId: string, control: AbortController) {
  while (!control.signal.aborted) {
    await new Promise((resolve) => setTimeout(resolve, CANCEL_POLL_MS))
    if (control.signal.aborted) {
      return
    }
    try {
      const rows = await executeDatabaseQuery(
        queryDatabase(pool)
          .select({ state: processingAttempts.state })
          .from(processingAttempts)
          .where(eq(processingAttempts.id, attemptId)),
      )
      if (rows[0]?.state !== 'running') {
        control.abort()
      }
    } catch {
      // Database uncertainty stops new provider work, as for earlier profiles.
      control.abort()
    }
  }
}

function inboxText(item: { id: string; seq: bigint; kind: string; payload: unknown }) {
  return `Inbox item ${item.id} (sequence ${item.seq}, ${item.kind}): ${JSON.stringify(item.payload)}`
}

const STYLE_GUIDANCE =
  'Write each Part description you propose in the pattern part_description_style gives, the operator’s saved style. It is still one line of at most 250 characters.'

const WEB_ON =
  'Public web pages are allowed in this session: after searching, read pages with WebFetch, where available, or curl, both through the session’s proxy.'
const WEB_OFF =
  'Public web pages are not available in this session: rely on search results and the staged evidence. A WebFetch or curl to a public site is refused.'
const DATASHEETS =
  'Prefer manufacturer datasheets over distributor pages, and take exact values from the datasheet.'

/** Asks for status lines the operator can read; not digest-bound, so new sessions get it. */
export const STATUS_GUIDANCE =
  'Write each status line in plain words about the item, such as “Proposed GE S2CN1 diodes as a 1N4148-class switching diode”, without internal IDs such as proposal, observation or attempt identifiers.'

/** The sealed web research lines for a VM tool session; other sessions have no web access. */
function webGuidance(manifest: SessionInputDto) {
  if (webAccess(manifest.profile_id) !== 'available') {
    return ''
  }
  // An attempt sealed before web research existed runs with both off.
  const web = manifest.web ?? { public_pages: false, prefer_datasheets: false }
  return `${web.public_pages ? WEB_ON : WEB_OFF} ${web.prefer_datasheets ? `${DATASHEETS} ` : ''}`
}

const INBOX_GUIDANCE =
  'Check read_inbox whenever pending_inbox is above zero. An instruction item is the operator’s saved instruction for the batch, or for one evidence group when it names one: follow it from then on; empty text withdraws the earlier one.'
const CATALOGUE_GUIDANCE =
  'Put catalogue values in the proposal’s catalogue block, each with its sources, and with source_kind and agreement when you know them: an existing category, parameter, manufacturer or supplier as the observed reference, or a proposed_new name with a reason when none exists. Only existing references can enter a Part spec; the rest are kept for the operator. When sources disagree on a parameter, give the value you used, the others as alternatives with their sources, and chosen_because. List the category’s mapped templates you found no value for in required_missing, each with why. For an existing category, give the reason you chose it and any alternative you considered; name the nearest existing Part you chose not to reuse in not_reused, with why.'
const BRIEF_GUIDANCE =
  'Your brief is in brief: the batch, the human-provided facts (source "human"; weigh them first), the questions already asked, the evidence you may fetch with the regions earlier stages read, and your stage’s sections. When brief.rest is set, call the tool it names with its arguments, then pass each page’s next_page_token the same way for the next page; read_lot always takes your lot_id. Without page_token or revision the tool returns the current brief and its revision. A page whose newer is set comes from an older brief.'

/** The opening of a `/7` session: its sealed brief within its budget, and where the rest is. */
function stageOpeningText(manifest: ProcessingInputV7Dto, pending: number, attemptId: string) {
  const tool = manifest.stage === 'examine' ? 'read_batch' : 'read_lot'
  const brief = openingBrief(manifest.brief, (page, shown, total) => ({
    shown,
    total,
    tool,
    arguments: {
      ...(manifest.subject_id ? { lot_id: manifest.subject_id } : {}),
      page_token: pageToken({ attemptId, view: 'sealed', digest: manifest.brief.sha256, page }),
    },
  }))
  return JSON.stringify({
    stage: manifest.stage,
    capture_revision: manifest.capture_revision,
    subject_id: manifest.subject_id,
    brief,
    pending_inbox: pending,
    ...(manifest.part_description_style
      ? { part_description_style: manifest.part_description_style }
      : {}),
    instructions:
      (manifest.stage === 'examine' ? `${LEAD_INSTRUCTIONS} ` : '') +
      `${BRIEF_GUIDANCE} ` +
      (manifest.part_description_style ? `${STYLE_GUIDANCE} ` : '') +
      webGuidance(manifest) +
      'Report steps with status, publish proposals with propose, ask questions with ask and keep working. ' +
      `${ASK_GUIDANCE} ` +
      `${INBOX_GUIDANCE} ` +
      CATALOGUE_GUIDANCE,
  })
}

/** Exported for tests. A `/7` opening needs the attempt, which its page tokens name. */
export function openingText(
  manifest: SessionInputDto,
  pending: number,
  resumed: boolean,
  attemptId?: string,
) {
  if (resumed) {
    return `You have ${pending} new inbox item(s). Call read_inbox and continue.`
  }
  if (manifest.schema_version === 'bench-intake-input/7') {
    return stageOpeningText(manifest, pending, attemptId ?? fail('session_attempt_required'))
  }
  const media = decodeMediaInputs(
    Buffer.from(manifest.media.manifest, 'utf8'),
    Buffer.from(manifest.media.sha256, 'hex'),
  )
  // A prompt, not retained authority, so plain JSON is enough.
  return JSON.stringify({
    stage: manifest.stage,
    capture_revision: manifest.capture_revision,
    subject_id: manifest.subject_id,
    subject: manifest.subject,
    linked_part: manifest.linked_part,
    defaults: manifest.defaults,
    notes: evidenceNotes(manifest.notes, manifest.batch_id).map((note) => ({
      ...note,
      text_sha256: sha256(Buffer.from(note.text, 'utf8')).toString('hex'),
    })),
    evidence: media.versions.map((version) => ({
      evidence_id: version.evidenceId,
      version_id: version.versionId,
      sha256: version.digest,
      media_type: version.mediaType,
    })),
    pending_inbox: pending,
    // Operator guidance sealed at queue time; kept out of the profile instructions and their digest.
    ...(manifest.part_description_style
      ? { part_description_style: manifest.part_description_style }
      : {}),
    instructions:
      (manifest.stage === 'examine' ? `${LEAD_INSTRUCTIONS} ` : '') +
      (manifest.part_description_style ? `${STYLE_GUIDANCE} ` : '') +
      webGuidance(manifest) +
      'Report steps with status, publish proposals with propose, ask questions with ask and keep working. ' +
      `${STATUS_GUIDANCE} ` +
      `${ASK_GUIDANCE} ` +
      `${INBOX_GUIDANCE} ` +
      CATALOGUE_GUIDANCE,
  })
}

/** The tool profile a session's input must seal: its profile's for `/6`, the stage one for `/7`. */
function sealedToolProfile(manifest: SessionInputDto) {
  return expectedToolProfile(manifest.profile_id, manifest.schema_version)
}

/**
 * A `/7` session's stage pack, checked against the digest its input sealed, as the profile's
 * instructions are; null for `/6`, which has none.
 */
async function sealedStagePack(client: PoolClient, manifest: SessionInputDto) {
  if (manifest.schema_version !== 'bench-intake-input/7') {
    return null
  }
  const rows = await client.query<{ instruction_bytes: Buffer; instruction_digest: Buffer }>(
    `SELECT instruction_bytes,instruction_digest FROM public.processing_stage_instructions
     WHERE profile_id=$1 AND stage=$2`,
    [manifest.profile_id, manifest.stage],
  )
  const pack = rows.rows[0]
  if (
    !pack ||
    pack.instruction_digest.toString('hex') !== manifest.stage_instructions_sha256 ||
    !sha256(pack.instruction_bytes).equals(pack.instruction_digest)
  ) {
    throw new NativeSessionError('agent_input_invalid')
  }
  return pack.instruction_bytes.toString('utf8')
}

async function openQuestions(client: PoolClient, jobId: string) {
  const open = await executeDatabaseQuery(
    queryDatabase(client)
      .select({ id: processingQuestions.id })
      .from(processingQuestions)
      .where(and(eq(processingQuestions.jobId, jobId), eq(processingQuestions.state, 'open')))
      .limit(1),
  )
  return open.length > 0
}

/**
 * The state a wake moved the session from, or for a turn's own requeue the one it would have
 * settled in without the inbox.
 */
async function stateBeforeWake(
  client: PoolClient,
  attemptId: string,
  jobId: string,
): Promise<SessionStateDto> {
  const kept = await client.query<{ from_state: SessionStateDto }>(
    'SELECT from_state FROM public.agent_session_resume WHERE attempt_id=$1',
    [attemptId],
  )
  if (kept.rows[0]) {
    return kept.rows[0].from_state
  }
  return (await openQuestions(client, jobId)) ? 'waiting_input' : 'finished'
}

/** Whether every item above the lineage's cursor was withdrawn, and there is at least one. */
async function withdrawnOnly(client: PoolClient, lineageId: string) {
  const rows = await client.query<{ withdrawn: boolean }>(
    `SELECT count(*) > 0 AND bool_and(w.item_id IS NOT NULL) AS withdrawn
       FROM public.agent_session_inbox i
       LEFT JOIN public.agent_session_inbox_withdrawal w ON w.item_id=i.id
      WHERE i.session_lineage_id=$1
        AND i.seq > coalesce((SELECT c.acked_seq FROM public.agent_session_cursor c
                               WHERE c.session_lineage_id=$1),0)`,
    [lineageId],
  )
  return rows.rows[0]?.withdrawn === true
}

/**
 * The input the opening is rendered from: for `/7`, its sealed brief's inline pages without
 * evidence removed since sealing, which never reaches a session. The sealed bytes are unchanged.
 */
export async function openingManifest(client: PoolClient, manifest: SessionInputDto) {
  if (manifest.schema_version !== 'bench-intake-input/7') {
    return manifest
  }
  const pages = await Promise.all(
    manifest.brief.pages.map(async (page) =>
      page.entries
        ? { ...page, entries: await withoutRemovedMedia(client, manifest.batch_id, page.entries) }
        : page,
    ),
  )
  return { ...manifest, brief: { ...manifest.brief, pages } }
}

/** A claim that put its session back without a turn, with the state it settled in. */
function isIdleClaim(claimed: unknown): claimed is readonly ['idle', SessionStateDto] {
  return Array.isArray(claimed)
}

/** Runs one provider turn for a queued session and settles its next state. */
export async function runSessionTurn(
  deps: SessionRunnerDeps,
  attemptId: string,
  signal: AbortSignal,
) {
  const { pool, config, host } = deps

  const claim = () =>
    transaction(pool, async (client) => {
      // First, before any row lock: a worker that lost its lock claims nothing.
      await requireSupervisorFence(client, deps.fence, 'ownership')
      const rows = await executeDatabaseQuery(
        queryDatabase(client)
          .select({
            state: agentSessions.sessionState,
            attemptState: processingAttempts.state,
            turnCount: agentSessions.turnCount,
            lineageId: agentSessions.sessionLineageId,
            providerSessionId: agentSessions.nativeSessionId,
            jobId: processingAttempts.jobId,
            batchId: processingAttempts.batchId,
            inputBytes: processingInputs.manifestBytes,
            inputDigest: processingInputs.manifestDigest,
            instructions: processingProfileRecords.instructionBytes,
            instructionDigest: processingProfileRecords.instructionDigest,
            actorId: commands.actorId,
            targetId: commands.targetId,
            targetContextId: commands.targetContextId,
            archived: captureBatches.archived,
          })
          .from(agentSessions)
          .innerJoin(processingAttempts, eq(processingAttempts.id, agentSessions.attemptId))
          .innerJoin(commands, eq(commands.id, processingAttempts.commandId))
          .innerJoin(captureBatches, eq(captureBatches.id, processingAttempts.batchId))
          .innerJoin(processingInputs, eq(processingInputs.id, processingAttempts.inputId))
          .innerJoin(
            processingProfileRecords,
            eq(processingProfileRecords.id, processingAttempts.profileId),
          )
          .where(eq(agentSessions.attemptId, attemptId)),
      )
      const row = rows[0]
      if (!row || row.lineageId !== row.jobId) {
        throw new Error('session_not_queued')
      }
      // The retained command, not the workflow that delivered the attempt, binds the account.
      if (
        row.actorId !== config.actorId ||
        row.targetId !== config.targetId ||
        row.targetContextId !== config.targetContextId
      ) {
        throw new Error('session_command_binding_invalid')
      }
      // Capture first: a share lock on the batch orders this claim against a concurrent archive.
      const batch = await executeDatabaseQuery(
        queryDatabase(client)
          .select({ archived: captureBatches.archived })
          .from(captureBatches)
          .where(eq(captureBatches.id, row.batchId))
          .for('share'),
      )
      if (batch[0].archived) {
        // Archived work does not run; it stays queued and is not woken while archived.
        return 'archived' as const
      }
      // A paused batch's sessions stay queued, their inbox kept, until Resume.
      const paused = await executeDatabaseQuery(
        queryDatabase(client)
          .select({ batchId: agentBatchPauses.batchId })
          .from(agentBatchPauses)
          .where(eq(agentBatchPauses.batchId, row.batchId)),
      )
      if (paused.length) {
        return 'paused' as const
      }
      const manifest = decodeSessionInput(row.inputBytes, row.inputDigest)
      // No worker runs `shared-vm-agent/2` any more, so whichever worker finds one of its
      // attempts settles it: queued or requeued by a resume, it fails without starting, its
      // history kept, instead of waiting for a worker that will never come.
      if (manifest.profile_id === 'shared-vm-agent/2') {
        // Counted as a turn, so the session's views find this turn's diagnostic.
        const retired = await setSessionState(client, attemptId, row.jobId, 'failed', ['queued'], {
          countTurn: true,
        })
        if (retired === 'failed') {
          await retainSessionFailure(
            client,
            sessionFailure(new NativeSessionError('agent_profile_retired'), {
              attemptId,
              lineageId: row.jobId,
              turn: (row.turnCount + 1n).toString(),
              stage: 'startup',
              provider: manifest.agent?.provider ?? null,
              model: manifest.agent?.model ?? null,
            }),
          )
        }
        await publish(client, row.batchId)
        return retired === 'failed' ? ('retired' as const) : ('cancelled' as const)
      }
      // Drain a sealed VM turn on its paired deployment. A VM worker must also leave
      // pre-existing host turns for their original worker.
      if (
        (manifest.profile_id === 'shared-vm-agent/3' ||
          manifest.profile_id === 'shared-vm-agent/1' ||
          config.profileId === 'shared-vm-agent/3' ||
          config.profileId === 'shared-vm-agent/1') &&
        manifest.profile_id !== config.profileId
      ) {
        return 'waiting' as const
      }
      if (
        row.instructionDigest.toString('hex') !== manifest.instruction_sha256 ||
        !sha256(row.instructions).equals(row.instructionDigest)
      ) {
        throw new NativeSessionError('agent_input_invalid')
      }
      // The sealed tool profile, and for `/7` the stage pack, are checked as the profile is.
      if (manifest.tool_profile_version !== sealedToolProfile(manifest)) {
        throw new NativeSessionError('agent_input_invalid')
      }
      const stagePack = await sealedStagePack(client, manifest)
      // Superseded before it started (its lot regrouped, or a new attempt replaced it): settle
      // the session and never run it.
      if (row.attemptState === 'superseded' || row.attemptState === 'cancelled') {
        await setSessionState(client, attemptId, row.jobId, 'cancelled', ['queued'])
        await publish(client, row.batchId)
        return 'cancelled' as const
      }
      if (row.state !== 'queued') {
        throw new Error('session_not_queued')
      }
      // A successor starts only while the identity it was pinned to is still current. Once it has
      // run, a revised identity reaches it as an inbox item instead, so a resume is never stopped.
      if (
        row.turnCount === 0n &&
        !(await pinnedIdentityCurrent(client, manifest.pinned_proposal_ids))
      ) {
        await supersedeJobAttempts(client, row.jobId)
        await setSessionState(client, attemptId, row.jobId, 'cancelled', ['queued'])
        await publish(client, row.batchId)
        return 'cancelled' as const
      }
      // Inventory waits, queued and without a slot, until the lot's Research and Images are current.
      if (
        manifest.stage === 'inventory' &&
        manifest.subject_id &&
        !(await successorsCurrent(client, row.batchId, manifest.subject_id))
      ) {
        return 'waiting' as const
      }
      // A resume whose only pending items were withdrawn since it was queued has nothing to do:
      // the session goes back to the state its last turn left it in, without a turn.
      if (row.turnCount > 0n && (await withdrawnOnly(client, row.jobId))) {
        const idle = await stateBeforeWake(client, attemptId, row.jobId)
        const settled = await setSessionState(client, attemptId, row.jobId, idle, ['queued'])
        await publish(client, row.batchId)
        if (settled === 'cancelled') {
          return 'cancelled' as const
        }
        return ['idle', idle] as const
      }
      // Without a free slot the session stays queued; the caller waits and tries again.
      if (!(await claimSessionSlot(client, config, attemptId))) {
        return undefined
      }
      const state = await setSessionState(client, attemptId, row.jobId, 'running', ['queued'], {
        countTurn: true,
      })
      if (state === 'cancelled') {
        await releaseSessionSlot(client, attemptId)
        await publish(client, row.batchId)
        return 'cancelled' as const
      }
      if (state !== 'running') {
        throw new Error('session_not_queued')
      }
      // The turn this claim committed, read under the session row's lock: a duplicate workflow
      // may have run and requeued the session since `row` was read.
      const claimedRows = await executeDatabaseQuery(
        queryDatabase(client)
          .select({
            turnCount: agentSessions.turnCount,
            providerSessionId: agentSessions.nativeSessionId,
          })
          .from(agentSessions)
          .where(eq(agentSessions.attemptId, attemptId)),
      )
      const claimedTurn = claimedRows[0].turnCount
      await recordSlotTurn(client, attemptId, claimedTurn)
      const capability = await issueSessionCapability(client, attemptId)
      await publish(client, row.batchId)
      return {
        ...row,
        turnCount: claimedTurn - 1n,
        providerSessionId: claimedRows[0].providerSessionId,
        manifest,
        opening: await openingManifest(client, manifest),
        stagePack,
        capability,
        pending: await pendingSessionInbox(client, row.jobId),
      }
    })

  // A bounded wait: the workflow gives its worker back and the wake sweep starts another.
  const waitUntil = Date.now() + SLOT_WAIT_LIMIT_MS
  let claimed = await claim()
  while (!claimed) {
    await new Promise((resolve) => setTimeout(resolve, SLOT_WAIT_MS))
    if (signal.aborted || Date.now() > waitUntil) {
      return 'queued' as const
    }
    claimed = await claim()
  }
  if (claimed === 'cancelled') {
    return 'cancelled' as const
  }
  if (claimed === 'retired') {
    return 'failed' as const
  }
  if (isIdleClaim(claimed)) {
    return claimed[1]
  }
  if (claimed === 'archived' || claimed === 'paused' || claimed === 'waiting') {
    return 'queued' as const
  }
  const current = claimed

  // Read lazily, inside the turn's error handling, so a failure here still settles the claim.
  let delivered: bigint | undefined
  // The highest sequence the CLI accepted in turn; acknowledged only when the turn succeeds.
  let accepted = 0n
  const resumed = current.providerSessionId !== null
  let diagnostic: SessionFailureDto | undefined
  let diagnosticStage: SessionFailureDto['stage'] = 'startup'
  let providerSessionId = current.providerSessionId
  let cliVersion: string | undefined
  let actualModel = current.manifest.agent?.model

  const captureFailure = (error: unknown, stage = diagnosticStage) =>
    sessionFailure(error, {
      attemptId,
      lineageId: current.jobId,
      turn: (current.turnCount + 1n).toString(),
      stage,
      provider: current.manifest.agent?.provider,
      model: actualModel,
      providerSessionId,
      cliVersion,
    })

  const turn: SessionTurn = {
    onCliVersion: (version) => {
      cliVersion = version
    },
    // A `/7` session's system prompt is the profile's instructions followed by its stage pack.
    instructions:
      current.stagePack === null
        ? current.instructions.toString('utf8')
        : `${current.instructions.toString('utf8')}\n\n${current.stagePack}`,
    text: openingText(current.opening, current.pending, resumed, attemptId),
    resume: current.providerSessionId ?? undefined,
    toolUrl: deps.toolUrl,
    capability: current.capability,
    tools: sessionToolNames(current.manifest),
    // At least once: items stay pending until the session acknowledges them with read_inbox.
    nextDelivery: async () => {
      if (delivered === undefined) {
        const cursor = await pool.query<{ acked_seq: string }>(
          'SELECT acked_seq FROM agent_session_cursor WHERE session_lineage_id=$1',
          [current.jobId],
        )
        delivered = BigInt(cursor.rows[0]?.acked_seq ?? '0')
      }
      const after = delivered
      // Given under the batch's share lock, so an ungroup either withdraws it first or keeps it.
      const next = await transaction(pool, async (client) => {
        await lockInboxBatch(client, current.jobId)
        const rows = await executeDatabaseQuery(
          queryDatabase(client)
            .select()
            .from(agentSessionInbox)
            .where(
              and(
                eq(agentSessionInbox.sessionLineageId, current.jobId),
                sql`${agentSessionInbox.seq} > ${after.toString()}::bigint`,
                deliverableInboxItem(),
              ),
            )
            .orderBy(agentSessionInbox.seq)
            .limit(1),
        )
        await releaseInboxItems(
          client,
          rows.map((row) => row.id),
        )
        return rows
      })
      if (!next[0]) {
        return undefined
      }
      delivered = next[0].seq
      return { text: inboxText(next[0]), seq: next[0].seq }
    },
    onDelivered: (seq) => {
      if (seq > accepted) {
        accepted = seq
      }
    },
    onStarted: (started) => {
      diagnosticStage = 'turn'
      providerSessionId = started.providerSessionId
      actualModel = started.actualModel
      return recordSessionProgress(pool, config, attemptId, {
        nativeSessionId: started.providerSessionId,
        actualModel: started.actualModel,
        progress: 'responding',
      })
    },
  }

  // One controller per turn: worker shutdown, the attempt leaving `running` or the deadline
  // aborts the child.
  const turnControl = new AbortController()

  const stopTurn = () => turnControl.abort()

  let expired = false
  const deadline = setTimeout(() => {
    expired = true
    turnControl.abort()
  }, deps.turnDeadlineMs ?? SESSION_TURN_DEADLINE_MS)

  signal.addEventListener('abort', stopTurn, { once: true })
  // A shutdown during the claim already fired; the turn ends before any child starts.
  if (signal.aborted) {
    turnControl.abort()
  }
  const watching = watchAttempt(pool, attemptId, turnControl)
  let next: SessionStateDto
  try {
    const cwd = await privateDirectory(join(host.stateRoot, 'sessions', current.jobId))
    const turnNumber = current.turnCount + 1n

    const recordChild = (child: TurnChild) =>
      recordTurnChild(pool, attemptId, turnNumber, child, deps.fence)

    const driver = deps.drivers?.[current.manifest.profile_id] ?? builtInDriver(host, current)
    await driver(turn, {
      manifest: current.manifest,
      cwd,
      signal: turnControl.signal,
      identity: { attemptId, turn: turnNumber.toString(), lineage: current.jobId },
      recordChild,
    })
    next = 'finished'
  } catch (error) {
    if (error instanceof ResearchReapPendingError) {
      clearTimeout(deadline)
      signal.removeEventListener('abort', stopTurn)
      turnControl.abort()
      await watching
      const pendingFailure = captureFailure(new NativeSessionError('agent_reap_pending'), 'reap')
      try {
        await transaction(pool, async (client) => {
          if (await retainSessionFailure(client, pendingFailure)) {
            await publish(client, current.batchId)
          }
        })
      } catch {
        process.stderr.write(
          JSON.stringify({
            event: 'session_diagnostic_unavailable',
            correlation_id: pendingFailure.correlation_id,
          }) + '\n',
        )
      }
      // The child was not confirmed gone, so the session keeps its slot and stays visible.
      throw error
    }
    diagnostic = captureFailure(
      expired && !signal.aborted
        ? new NativeSessionError('agent_timeout')
        : signal.aborted
          ? new NativeSessionError('agent_worker_interrupted')
          : turnControl.signal.aborted
            ? new NativeSessionError('agent_cancelled')
            : error,
    )
    if (error instanceof SessionResumeUnavailable) {
      next = 'resume_unavailable'
    } else if (expired && !signal.aborted) {
      // The child was reaped (an unconfirmed reap throws above), so the slot can be released.
      next = 'failed'
    } else if (turnControl.signal.aborted) {
      next = 'interrupted'
    } else if (
      error instanceof NativeSessionError &&
      (error.code === 'agent_process_failed' || error.code === 'agent_delivery_failed')
    ) {
      // A provider crash is resumable, like a worker restart; refusals are failures.
      next = 'interrupted'
    } else if (error instanceof NativeSessionError && error.code === 'agent_login_required') {
      next = 'waiting_for_login'
    } else {
      next = 'failed'
    }
  }

  clearTimeout(deadline)
  signal.removeEventListener('abort', stopTurn)
  turnControl.abort()
  await watching

  const settle = () =>
    transaction(pool, async (client) => {
      // A worker that lost its lock settles only while no replacement holds it.
      await requireSupervisorFence(client, deps.fence, 'settlement')
      // The batch first, as an ungroup takes it, so a withdrawal it commits is seen below and a
      // withdrawn item doesn't requeue the session. Then job and attempt, as everywhere.
      await client.query('SELECT 1 FROM public.capture_batch WHERE id=$1 FOR SHARE', [
        current.batchId,
      ])
      const locked = await lockProcessingAttempt(client, current.jobId, attemptId)
      // A worker that lost its lock may settle after a replacement recovered this turn and started
      // the next one; that turn's state, capability and slot are not this settlement's to change.
      const sessionNow = await executeDatabaseQuery(
        queryDatabase(client)
          .select({ turnCount: agentSessions.turnCount, state: agentSessions.sessionState })
          .from(agentSessions)
          .where(eq(agentSessions.attemptId, attemptId))
          .for('update'),
      )
      const settledTurn = current.turnCount + 1n
      // Nor is a slot a startup check already released for this turn.
      const ownSlot = await executeDatabaseQuery(
        queryDatabase(client)
          .select({ slot: agentSlots.slotIndex })
          .from(agentSlots)
          .where(and(eq(agentSlots.attemptId, attemptId), eq(agentSlots.turn, settledTurn))),
      )
      if (sessionNow[0]?.turnCount !== settledTurn || !ownSlot.length) {
        return sessionNow[0]?.state ?? next
      }
      // A wake's earlier state no longer applies once a turn has run.
      await client.query('DELETE FROM public.agent_session_resume WHERE attempt_id=$1', [attemptId])
      // A cancelled, superseded or replaced attempt leaves input pending for whatever replaces it.
      const live =
        locked.attempt.state === 'running' && locked.job.current_attempt_id === locked.attempt.id
      if (next === 'finished' && accepted > 0n && live) {
        await acknowledgeSessionInbox(client, current.jobId, accepted)
      }
      if (next === 'finished') {
        if ((await pendingSessionInbox(client, current.jobId)) > 0) {
          next = 'queued'
        } else if (await openQuestions(client, current.jobId)) {
          next = 'waiting_input'
        }
      }
      // Job and attempt first, then the session row, as the tool handlers lock them.
      const settled = (await setSessionState(client, attemptId, current.jobId, next)) || next
      if (diagnostic) {
        await retainSessionFailure(client, diagnostic)
      }
      await revokeSessionCapability(client, attemptId)
      await releaseSessionSlot(client, attemptId)
      await executeDatabaseQuery(
        queryDatabase(client)
          .update(agentSessions)
          .set({ progress: 'settled', finishedAt: new Date() })
          .where(eq(agentSessions.attemptId, attemptId)),
      )
      await publish(client, current.batchId)
      return settled
    })

  return retryFenceRefusal(
    settle,
    attemptId,
    deps.settlementFenceRetryMs ?? SETTLEMENT_FENCE_RETRY_MS,
  )
}

/** The host's own provider driver; it starts host processes, so it records that first. */
function builtInDriver(
  host: NativeAgentHost,
  current: { manifest: SessionInputDto },
): SessionDriver {
  const selection = current.manifest.agent
  if (current.manifest.profile_id !== 'native-agent/2' || !selection) {
    throw new NativeSessionError('agent_input_invalid')
  }
  const native = nativeDriver(host, selection)
  return async (turn, context) => {
    await context.recordChild?.({ kind: 'host' })
    return native(turn, context)
  }
}

export function nativeDriver(
  host: NativeAgentHost,
  selection: NonNullable<SessionInputDto['agent']>,
): SessionDriver {
  return async (turn, context) => {
    const env = agentEnvironment(host, selection, context.cwd)
    if (selection.provider === 'codex') {
      await privateDirectory(env.CODEX_HOME!)
      return runCodexSession(host, selection, turn, context.cwd, env, context.signal)
    }
    return runClaudeSession(host, selection, turn, context.cwd, env, context.signal)
  }
}

/**
 * The deterministic `synthetic-session/1` runner. It calls the same tools as a provider: a status
 * line, a proposal citing the first delivered note, and replies to chat. When nothing has been
 * answered yet it asks one quantity question and ends, so the answer arrives through a resume.
 */
export const syntheticSessionDriver: SessionDriver = async (turn, context) => {
  const client = new Client({ name: 'synthetic-session', version: '1' })
  await client.connect(
    new StreamableHTTPClientTransport(new URL(turn.toolUrl), {
      requestInit: { headers: { Authorization: `Bearer ${turn.capability}` } },
    }),
  )
  await turn.onStarted({
    providerSessionId: `synthetic-${context.manifest.batch_id}`,
    actualModel: 'synthetic',
  })

  const call = async (name: string, args: Record<string, unknown>) => {
    context.signal.throwIfAborted()
    const result = await client.callTool({ name, arguments: args })
    return result.structuredContent as {
      ok: boolean
      items?: { id: string; seq: string; kind: string; payload?: Record<string, unknown> }[]
    }
  }

  try {
    await syntheticTurn(turn, context, call)
  } finally {
    await closeWithin(client, SYNTHETIC_CLOSE_MS)
  }
}

/** How long a synthetic turn waits for its MCP client to close before going on without it. */
const SYNTHETIC_CLOSE_MS = 5_000

/** Closes an MCP client, giving up after `ms`, so a slow tool server can't hold a turn open. */
export async function closeWithin(client: Client, ms: number) {
  let timer: NodeJS.Timeout | undefined
  await Promise.race([
    client.close().catch(() => undefined),
    new Promise<void>((resolve) => {
      timer = setTimeout(resolve, ms)
    }),
  ])
  clearTimeout(timer)
}
