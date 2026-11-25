import type { PoolClient } from 'pg'
import type {
  SealedBriefDto,
  SessionHistoryBriefDto,
  SessionHistoryBriefRefDto,
} from '@invimport/contracts'
import { sealedBriefPage } from '#/processing/brief-pages.ts'
import { withoutRemovedMedia } from '#/processing/brief-removal.ts'

/** A `/7` attempt's sealed brief, where its input keeps it, and when the attempt was queued. */
export interface AttemptBrief {
  attemptId: string
  inputId: string
  queuedAt: string
  brief: SealedBriefDto
}

/**
 * The bounds of one history page, as the times of the rows at its edges. Rows page by their full
 * position (time, stream, attempt, sequence); a brief needs only the time, since it sorts before
 * every row at its own.
 */
export interface PageSpan {
  /** The time of the cursor's row, the oldest of the newer page. Absent for the newest page. */
  before?: string
  /** The time of the page's oldest row while older rows remain on further pages. */
  oldest?: string
}

/**
 * Whether a brief belongs on a page. A brief sorts before every row at its attempt's queue time,
 * so it is older than a row at the same time: it is on the page when the cursor's row is at or
 * after it, and the page's oldest row before it, or no page follows.
 */
function onPage(queuedAt: string, span: PageSpan) {
  const belowCursor = span.before === undefined || queuedAt <= span.before
  const aboveOldest = span.oldest === undefined || queuedAt > span.oldest
  return belowCursor && aboveOldest
}

/**
 * Where the briefs of the `/7` attempts queued within the page's span sit, newest first. Only the
 * place: a page never reads a brief's content, so its size and its reads don't grow with them.
 */
export function historyBriefRefs(
  attempts: readonly AttemptBrief[],
  span: PageSpan,
): SessionHistoryBriefRefDto[] {
  return attempts
    .filter((attempt) => onPage(attempt.queuedAt, span))
    .map((attempt) => ({ attempt_id: attempt.attemptId, at: attempt.queuedAt }))
}

/**
 * Every page of an attempt's sealed brief, from the manifest and the input's page store, without
 * what concerns evidence removed since, as a session's read tools serve it, with its sealed
 * sections.
 */
export async function attemptBrief(
  client: PoolClient,
  batchId: string,
  attempt: AttemptBrief,
): Promise<SessionHistoryBriefDto> {
  const { brief } = attempt
  const sealedEntries = []
  for (const page of brief.pages) {
    sealedEntries.push(...(await sealedBriefPage(client, attempt.inputId, brief, page.index)))
  }
  const entries = await withoutRemovedMedia(client, batchId, sealedEntries)
  return {
    attempt_id: attempt.attemptId,
    at: attempt.queuedAt,
    brief: {
      schema_version: brief.schema_version,
      stage: brief.stage,
      lot_id: brief.lot_id,
      revision: brief.revision,
      sections: brief.sections,
      entries,
    },
  }
}
