import type {
  SessionFailureSummaryDto,
  SessionHistoryDto,
  SessionHistoryEntryDto,
  SessionOutboxItemDto,
} from '@invimport/contracts'

/** What the driver collects about one session: every history entry and its current failure. */
export interface SessionTrace {
  /** Oldest first, across every page of the history read. */
  entries: SessionHistoryEntryDto[]
  failure?: SessionFailureSummaryDto
  /** The status, reply and question items, shaped as `chatHandled` reads outbox items. */
  outbox: Pick<SessionOutboxItemDto, 'session_id' | 'created_at' | 'kind' | 'payload'>[]
  /** Each inbox entry's sequence and time, to match a chat to its receipt. */
  inbox: { seq: string; created_at: string }[]
  observations: number
}

/** The attempt an outbox entry belongs to, from its `outbox:<attempt>:<seq>` ID. */
function attemptOf(entry: SessionHistoryEntryDto) {
  return entry.id.split(':')[1] ?? ''
}

function outboxItem(entry: SessionHistoryEntryDto): SessionTrace['outbox'] {
  const base = { session_id: attemptOf(entry), created_at: entry.at }
  const { details } = entry
  if (details.kind === 'status') {
    return [{ ...base, kind: 'status', payload: { text: details.text } }]
  }
  if (details.kind === 'reply') {
    return [
      {
        ...base,
        kind: 'reply',
        payload: { inbox_item_id: details.inbox_item_id, text: details.text },
      },
    ]
  }
  if (details.kind === 'question') {
    return [{ ...base, kind: 'question', payload: { question_id: details.question_id } }]
  }
  return []
}

/** Reads every page of a session's history, newest first from the API, and returns it oldest first. */
export async function readSessionTrace(
  read: (before?: string) => Promise<SessionHistoryDto>,
): Promise<SessionTrace> {
  const pages: SessionHistoryDto[] = []
  let before: string | undefined
  do {
    const page = await read(before)
    pages.push(page)
    before = page.before
  } while (before !== undefined)
  const { session } = pages[0]
  const entries = pages.flatMap((page) => page.entries).reverse()
  const current = session.attempts.find((attempt) => attempt.id === session.current_attempt_id)
  const agentEntries = entries.filter((entry) => entry.who === 'agent')
  return {
    entries,
    ...(current?.failure ? { failure: current.failure } : {}),
    outbox: agentEntries.flatMap(outboxItem),
    inbox: entries.flatMap((entry) =>
      entry.who === 'agent' ? [] : [{ seq: entry.id.slice('inbox:'.length), created_at: entry.at }],
    ),
    observations: agentEntries.filter((entry) => entry.details.kind === 'observation').length,
  }
}
