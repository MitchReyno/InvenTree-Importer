import { join } from 'node:path'
import { and, eq, inArray, sql } from 'drizzle-orm'
import type { Pool, PoolClient } from 'pg'
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client'
import type { ProcessingInputV6Dto, SessionStateDto } from '@invimport/contracts'
import { executeDatabaseQuery, queryDatabase, transaction } from '../db/database.ts'
import { appendEvent, sha256 } from '../db/authority.ts'
import type { ProcessingConfig } from '../processing/attempts.ts'
import { captureBatches } from '../capture/schema.ts'
import { commands } from '../db/schema.ts'
import {
  processingAttempts,
  processingInputs,
  processingProfileRecords,
  processingQuestions,
} from '../processing/schema.ts'
import { lockProcessingAttempt, transitionAttempt } from '../processing/state.ts'
import { decodeSessionInput } from '../processing/session-input.ts'
import { evidenceNotes } from '../capture/context-input.ts'
import { decodeMediaInputs } from '../media/inputs.ts'
import { agentSessions, agentSessionInbox } from './schema.ts'
import { agentEnvironment, privateDirectory, type NativeAgentHost } from './environment.ts'
import { recordSessionProgress } from './sessions.ts'
import { issueSessionCapability, revokeSessionCapability } from './tools/capability.ts'
import { pendingSessionInbox } from './tools/inbox.ts'
import { claimSessionSlot, releaseSessionSlot } from './slots.ts'
import {
  runClaudeSession,
  runCodexSession,
  SessionResumeUnavailable,
  type SessionTurn,
} from './session-adapters.ts'
import { ResearchReapPendingError } from '../research/errors.ts'

/** Tools every session gets; the lot-forming tools are added for the Examine lead session. */
const SLOT_WAIT_MS = 500
const SLOT_WAIT_LIMIT_MS = 30_000
const CANCEL_POLL_MS = 500

export const SESSION_TOOLS = ['ask', 'fetch_evidence', 'propose', 'read_inbox', 'reply', 'status']

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
  manifest: ProcessingInputV6Dto
  cwd: string
  signal: AbortSignal
}
export type SessionDriver = (turn: SessionTurn, context: SessionDriverContext) => Promise<void>

export interface SessionRunnerDeps {
  pool: Pool
  config: ProcessingConfig
  host: NativeAgentHost
  toolUrl: string
  /** Replaces the provider for a profile, for the synthetic profile and process tests. */
  drivers?: Partial<Record<ProcessingInputV6Dto['profile_id'], SessionDriver>>
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
  const cancelled = attempt.state === 'cancelled' || attempt.state === 'superseded'
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
export async function interruptRunningSessions(pool: Pool, config: ProcessingConfig) {
  return transaction(pool, async (client) => {
    // Only this worker's account: another actor's worker may be running its own sessions.
    const running = await executeDatabaseQuery(
      queryDatabase(client)
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
            inArray(agentSessions.sessionState, ['running', 'cancelling']),
          ),
        ),
    )
    const interrupted: string[] = []
    for (const session of running) {
      // The fence refused to start while any slot was held, so these slots are already clear.
      const changed = await setSessionState(
        client,
        session.attemptId,
        session.jobId,
        'interrupted',
        ['running', 'cancelling'],
      )
      if (changed) {
        await revokeSessionCapability(client, session.attemptId)
        await publish(client, session.batchId)
        interrupted.push(session.attemptId)
      }
    }
    return interrupted
  })
}

/** Settles queued sessions whose attempt was cancelled or superseded before any claim. */
export async function settleCancelledQueuedSessions(pool: Pool, config: ProcessingConfig) {
  return transaction(pool, async (client) => {
    const stale = await executeDatabaseQuery(
      queryDatabase(client)
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
            eq(agentSessions.sessionState, 'queued'),
            inArray(processingAttempts.state, ['cancelled', 'superseded']),
          ),
        ),
    )
    for (const session of stale) {
      if (
        (await setSessionState(client, session.attemptId, session.jobId, 'cancelled', [
          'queued',
        ])) === 'cancelled'
      ) {
        await publish(client, session.batchId)
      }
    }
    return stale.length
  })
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
  if (
    (await setSessionState(client, session.attemptId, lineageId, 'queued', RESUMABLE)) !== 'queued'
  ) {
    return undefined
  }
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

function openingText(manifest: ProcessingInputV6Dto, pending: number, resumed: boolean) {
  if (resumed) {
    return `You have ${pending} new inbox item(s). Call read_inbox and continue.`
  }
  const media = decodeMediaInputs(
    Buffer.from(manifest.media.manifest, 'utf8'),
    Buffer.from(manifest.media.sha256, 'hex'),
  )
  // A prompt, not retained authority, so plain JSON is enough.
  return JSON.stringify({
    stage: manifest.stage,
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
    instructions:
      'Report steps with status, publish proposals with propose, ask questions with ask and keep working. Check read_inbox whenever pending_inbox is above zero.',
  })
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
      const rows = await executeDatabaseQuery(
        queryDatabase(client)
          .select({
            state: agentSessions.sessionState,
            lineageId: agentSessions.sessionLineageId,
            providerSessionId: agentSessions.nativeSessionId,
            jobId: processingAttempts.jobId,
            batchId: processingAttempts.batchId,
            inputBytes: processingInputs.manifestBytes,
            inputDigest: processingInputs.manifestDigest,
            instructions: processingProfileRecords.instructionBytes,
            instructionDigest: processingProfileRecords.instructionDigest,
          })
          .from(agentSessions)
          .innerJoin(processingAttempts, eq(processingAttempts.id, agentSessions.attemptId))
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
      const manifest = decodeSessionInput(row.inputBytes, row.inputDigest)
      if (
        row.instructionDigest.toString('hex') !== manifest.instruction_sha256 ||
        !sha256(row.instructions).equals(row.instructionDigest)
      ) {
        throw new Error('agent_input_invalid')
      }
      if (row.state !== 'queued') {
        throw new Error('session_not_queued')
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
      const capability = await issueSessionCapability(client, attemptId)
      await publish(client, row.batchId)
      return {
        ...row,
        manifest,
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
  const current = claimed

  let delivered = await transaction(pool, async (client) => {
    const cursor = await client.query<{ acked_seq: string }>(
      'SELECT acked_seq FROM agent_session_cursor WHERE session_lineage_id=$1',
      [current.jobId],
    )
    return BigInt(cursor.rows[0]?.acked_seq ?? '0')
  })
  const resumed = current.providerSessionId !== null
  const turn: SessionTurn = {
    instructions: current.instructions.toString('utf8'),
    text: openingText(current.manifest, current.pending, resumed),
    resume: current.providerSessionId ?? undefined,
    toolUrl: deps.toolUrl,
    capability: current.capability,
    tools: SESSION_TOOLS,
    // At least once: items stay pending until the session acknowledges them with read_inbox.
    nextDelivery: async () => {
      const next = await executeDatabaseQuery(
        queryDatabase(pool)
          .select()
          .from(agentSessionInbox)
          .where(
            and(
              eq(agentSessionInbox.sessionLineageId, current.jobId),
              sql`${agentSessionInbox.seq} > ${delivered.toString()}::bigint`,
            ),
          )
          .orderBy(agentSessionInbox.seq)
          .limit(1),
      )
      if (!next[0]) {
        return undefined
      }
      delivered = next[0].seq
      return inboxText(next[0])
    },
    onStarted: (started) =>
      recordSessionProgress(pool, config, attemptId, {
        nativeSessionId: started.providerSessionId,
        actualModel: started.actualModel,
        progress: 'responding',
      }),
  }

  // One controller per turn: worker shutdown or the attempt leaving `running` aborts the child.
  const turnControl = new AbortController()

  const stopTurn = () => turnControl.abort()

  signal.addEventListener('abort', stopTurn, { once: true })
  const watching = watchAttempt(pool, attemptId, turnControl)
  let next: SessionStateDto
  try {
    const cwd = await privateDirectory(join(host.stateRoot, 'sessions', current.jobId))
    const driver =
      deps.drivers?.[current.manifest.profile_id] ??
      (current.manifest.agent
        ? nativeDriver(host, current.manifest.agent)
        : (() => {
            throw new Error('agent_input_invalid')
          })())
    await driver(turn, { manifest: current.manifest, cwd, signal: turnControl.signal })
    next = 'finished'
  } catch (error) {
    if (error instanceof ResearchReapPendingError) {
      // The child was not confirmed gone, so the session keeps its slot and stays visible.
      throw error
    }
    if (error instanceof SessionResumeUnavailable) {
      next = 'resume_unavailable'
    } else if (turnControl.signal.aborted) {
      next = 'interrupted'
    } else if (
      error instanceof Error &&
      (error.message === 'agent_process_failed' || error.message === 'agent_delivery_failed')
    ) {
      // A provider crash is resumable, like a worker restart; refusals are failures.
      next = 'interrupted'
    } else if (error instanceof Error && error.message === 'agent_login_required') {
      next = 'waiting_for_login'
    } else {
      next = 'failed'
    }
  }

  signal.removeEventListener('abort', stopTurn)
  turnControl.abort()
  await watching

  return transaction(pool, async (client) => {
    if (next === 'finished') {
      const pending = await pendingSessionInbox(client, current.jobId)
      const open = await executeDatabaseQuery(
        queryDatabase(client)
          .select({ id: processingQuestions.id })
          .from(processingQuestions)
          .where(
            and(
              eq(processingQuestions.jobId, current.jobId),
              eq(processingQuestions.state, 'open'),
            ),
          ),
      )
      if (pending > 0) {
        next = 'queued'
      } else if (open.length) {
        next = 'waiting_input'
      }
    }
    // Job and attempt first, then the session row, as the tool handlers lock them.
    const settled = (await setSessionState(client, attemptId, current.jobId, next)) || next
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
}

function nativeDriver(
  host: NativeAgentHost,
  selection: NonNullable<ProcessingInputV6Dto['agent']>,
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
      items?: { id: string; seq: string; kind: string }[]
    }
  }

  try {
    await call('status', { text: turn.resume ? 'Reading new inbox items' : 'Reading the evidence' })
    const read = await call('read_inbox', { after_seq: '0' })
    const items = read.items ?? []
    const note = evidenceNotes(context.manifest.notes, context.manifest.batch_id)[0]
    if (note && context.manifest.subject_id) {
      const source = {
        kind: 'note',
        note_id: note.id,
        text_sha256: sha256(Buffer.from(note.text, 'utf8')).toString('hex'),
      }
      await call('propose', {
        proposal: {
          schema_version: 'bench-intake-proposal/5',
          subject_id: context.manifest.subject_id,
          summary: 'Synthetic proposal from the delivered note.',
          sources: [source],
          relies_on: {
            fields: ['identity'],
            sources: [
              source,
              ...items.map((item) => ({ kind: 'inbox_item', inbox_item_id: item.id })),
            ],
          },
        },
      })
    }
    for (const item of items.filter((entry) => entry.kind === 'chat')) {
      await call('reply', { inbox_item_id: item.id, text: 'Synthetic reply: noted.' })
    }
    const answered = items.some((item) => item.kind === 'answer')
    if (!answered && !turn.resume && context.manifest.subject_id) {
      await call('ask', {
        kind: 'quantity',
        subject_id: context.manifest.subject_id,
        prompt: 'How many items are in this lot?',
        reason: 'The synthetic session cannot count.',
        fields: ['quantity'],
        assumption: 'Treating the lot as one item until answered.',
      })
    }
    const last = items.at(-1)
    if (last) {
      await call('read_inbox', { after_seq: last.seq })
    }
  } finally {
    await client.close()
  }
}
