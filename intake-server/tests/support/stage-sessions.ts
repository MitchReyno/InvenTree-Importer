import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client'
import type { SealedMatchDto, SessionToolResultDto } from '@invimport/contracts'
import { transaction } from '#/db/database.ts'
import { captureInTransaction } from '#/capture/repository.ts'
import { issueSessionCapability } from '#/agents/tools/capability.ts'
import { closeWithin } from '#/agents/session/session-runner.ts'
import { prepareMediaTransaction } from '#/media/transaction.ts'
import { queueJob } from '#/processing/jobs.ts'
import { currentBinding, currentOutcome, readMatch } from '#/processing/match/state.ts'
import { reserveProcessingMedia, reservedMediaFor } from '#/processing/media.ts'
import type { Fixture } from './lot-pipeline.ts'

/** Puts a queued or settled session in a running turn and returns its capability. */
export async function running(fixture: Fixture, attemptId: string) {
  await fixture.db.pool.query("UPDATE processing_attempt SET state='running' WHERE id=$1", [
    attemptId,
  ])
  await fixture.db.pool.query(
    "UPDATE agent_session SET session_state='running' WHERE attempt_id=$1",
    [attemptId],
  )
  return transaction(fixture.runner.pool, (client) => issueSessionCapability(client, attemptId))
}

async function connect(url: string, token: string) {
  const client = new Client({ name: 'stage-session-test', version: '1' })
  await client.connect(
    new StreamableHTTPClientTransport(new URL(url), {
      requestInit: { headers: { Authorization: `Bearer ${token}` } },
    }),
  )
  return client
}

type Succeeded = Extract<SessionToolResultDto, { ok: true }>
type Refused = Extract<SessionToolResultDto, { ok: false }>

/** Either result's fields, for assertions; `image_items` counts the image items it carried. */
export type StageToolResult = Partial<Omit<Succeeded, 'ok'>> &
  Partial<Omit<Refused, 'ok'>> & { ok: boolean; image_items: number }

/** A tool's result as the session reads it. */
export async function call(
  client: Client,
  name: string,
  args: Record<string, unknown>,
): Promise<StageToolResult> {
  const result = await client.callTool({ name, arguments: args })
  const imageItems = ((result.content ?? []) as { type: string }[]).filter(
    (item) => item.type === 'image',
  ).length
  return { ...(result.structuredContent as unknown as StageToolResult), image_items: imageItems }
}

/**
 * Opens MCP clients for the test body and closes them before the fixtures go, so the tool
 * server's close never waits on an open connection.
 */
export async function withClients(
  work: (open: (url: string, token: string) => Promise<Client>) => Promise<void>,
) {
  const clients: Client[] = []
  try {
    await work(async (url, token) => {
      const client = await connect(url, token)
      clients.push(client)
      return client
    })
  } finally {
    await Promise.all(clients.map((client) => closeWithin(client, 5_000)))
  }
}

/**
 * Queues a `/7` lot stage again, pinned to the identities given, in the mode given. With no
 * outcome given, it seals the lot's current Match outcome and Capture binding, so Match's claim
 * gate lets it run; a
 * mode the outcome wouldn't set is how tests reach the other modes. The job's earlier attempt is
 * superseded. Returns the new attempt.
 */
export async function requeueLot(
  fixture: Fixture,
  batchId: string,
  lotId: string,
  stage: 'research' | 'images',
  match: SealedMatchDto,
  pinnedProposalIds: readonly string[],
) {
  return transaction(fixture.writer.pool, async (client) => {
    const capture = await captureInTransaction(client, fixture.config, batchId, true)
    const row = match.outcome === null ? await readMatch(client, lotId) : undefined
    const current = row ? await currentOutcome(client, row) : undefined
    const sealed: SealedMatchDto = current
      ? {
          outcome: { revision: current.outcome.revision, basis: current.outcome.basis },
          mode: match.mode,
          binding: await currentBinding(client, lotId),
        }
      : match
    await prepareMediaTransaction(client)
    const media = reservedMediaFor(
      await reserveProcessingMedia(client, fixture.config, capture.snapshot, [lotId]),
      lotId,
    )
    const queued = await queueJob(
      client,
      fixture.config,
      capture.snapshot,
      lotId,
      stage,
      [],
      media,
      pinnedProposalIds,
      { lockSettings: false, inputVersion: 'bench-intake-input/7', match: sealed },
    )
    return queued.attemptId
  })
}
