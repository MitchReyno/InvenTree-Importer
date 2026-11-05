import { join } from 'node:path'
import { and, eq, inArray, sql } from 'drizzle-orm'
import type { Pool, PoolClient } from 'pg'
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client'
import type { ProcessingInputV6Dto, SessionStateDto } from '@invimport/contracts'
import { executeDatabaseQuery, queryDatabase, transaction } from '../db/database.ts'
import { appendEvent, sha256 } from '../db/authority.ts'
import type { ProcessingConfig } from '../processing/attempts.ts'
import { captureBatches } from '../capture/schema.ts'
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
import {
  runClaudeSession,
  runCodexSession,
  SessionResumeUnavailable,
  type SessionTurn,
} from './session-adapters.ts'
import { ResearchReapPendingError } from '../research/errors.ts'

/** Tools every session gets; the lot-forming tools are added for the Examine lead session. */
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
  state: SessionStateDto,
  expected?: SessionStateDto[],
) {
  const { job, attempt } = await lockProcessingAttempt(client, jobId, attemptId)
  const updated = await executeDatabaseQuery(
    queryDatabase(client)
      .update(agentSessions)
      .set({ sessionState: state })
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
  await transitionAttempt(client, job, attempt, attemptStateFor[state])
  return true
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
export async function interruptRunningSessions(pool: Pool) {
  return transaction(pool, async (client) => {
    const running = await executeDatabaseQuery(
      queryDatabase(client)
        .select({
          attemptId: agentSessions.attemptId,
          jobId: processingAttempts.jobId,
          batchId: processingAttempts.batchId,
        })
        .from(agentSessions)
        .innerJoin(processingAttempts, eq(processingAttempts.id, agentSessions.attemptId))
        .where(inArray(agentSessions.sessionState, ['running', 'cancelling'])),
    )
    const interrupted: string[] = []
    for (const session of running) {
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
  if (!(await setSessionState(client, session.attemptId, lineageId, 'queued', RESUMABLE))) {
    return undefined
  }
  await publish(client, session.batchId)
  return session.attemptId
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
  const claimed = await transaction(pool, async (client) => {
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
    if (!(await setSessionState(client, attemptId, row.jobId, 'running', ['queued']))) {
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

  let delivered = await transaction(pool, async (client) => {
    const cursor = await client.query<{ acked_seq: string }>(
      'SELECT acked_seq FROM agent_session_cursor WHERE session_lineage_id=$1',
      [claimed.jobId],
    )
    return BigInt(cursor.rows[0]?.acked_seq ?? '0')
  })
  const resumed = claimed.providerSessionId !== null
  const turn: SessionTurn = {
    instructions: claimed.instructions.toString('utf8'),
    text: openingText(claimed.manifest, claimed.pending, resumed),
    resume: claimed.providerSessionId ?? undefined,
    toolUrl: deps.toolUrl,
    capability: claimed.capability,
    tools: SESSION_TOOLS,
    // At least once: items stay pending until the session acknowledges them with read_inbox.
    nextDelivery: async () => {
      const next = await executeDatabaseQuery(
        queryDatabase(pool)
          .select()
          .from(agentSessionInbox)
          .where(
            and(
              eq(agentSessionInbox.sessionLineageId, claimed.jobId),
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

  let next: SessionStateDto
  try {
    const cwd = await privateDirectory(join(host.stateRoot, 'sessions', claimed.jobId))
    const driver =
      deps.drivers?.[claimed.manifest.profile_id] ??
      (claimed.manifest.agent
        ? nativeDriver(host, claimed.manifest.agent)
        : (() => {
            throw new Error('agent_input_invalid')
          })())
    await driver(turn, { manifest: claimed.manifest, cwd, signal })
    next = 'finished'
  } catch (error) {
    if (error instanceof ResearchReapPendingError) {
      throw error
    }
    if (error instanceof SessionResumeUnavailable) {
      next = 'resume_unavailable'
    } else if (signal.aborted) {
      next = 'interrupted'
    } else if (error instanceof Error && error.message === 'agent_process_failed') {
      // A provider crash is resumable, like a worker restart; refusals are failures.
      next = 'interrupted'
    } else if (error instanceof Error && error.message === 'agent_login_required') {
      next = 'waiting_for_login'
    } else {
      next = 'failed'
    }
  }

  return transaction(pool, async (client) => {
    await revokeSessionCapability(client, attemptId)
    if (next === 'finished') {
      const pending = await pendingSessionInbox(client, claimed.jobId)
      const open = await executeDatabaseQuery(
        queryDatabase(client)
          .select({ id: processingQuestions.id })
          .from(processingQuestions)
          .where(
            and(
              eq(processingQuestions.jobId, claimed.jobId),
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
    await executeDatabaseQuery(
      queryDatabase(client)
        .update(agentSessions)
        .set({ progress: 'settled', finishedAt: new Date() })
        .where(eq(agentSessions.attemptId, attemptId)),
    )
    await setSessionState(client, attemptId, claimed.jobId, next)
    await publish(client, claimed.batchId)
    return next
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
