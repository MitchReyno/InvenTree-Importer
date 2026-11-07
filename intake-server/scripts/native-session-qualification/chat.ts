import type { SessionOutboxItemDto } from '@invimport/contracts'

type Outbox = Pick<SessionOutboxItemDto, 'session_id' | 'created_at' | 'kind' | 'payload'>
export interface QualificationTrace {
  chat: { id: string; session_id: string; created_at: string; text: string }
  /** When the session was observed to read the chat; defaults to when it was sent. */
  readAt?: string
  outbox: Outbox[]
  questions: Record<string, { prompt: string; reason: string; assumption: string }>
}
export type ChatOutcome =
  { handled: true; by: 'reply' | 'question' | 'status' } | { handled: false }

const ignored = new Set(
  'about after again also been before chat from have into just make more only please same some such than that their them then there these they this were what when which will with would your'.split(
    ' ',
  ),
)
/** Words and numbers specific enough to show the output is about the chat. */
function terms(text: string) {
  return new Set(
    text
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter((word) =>
        /\d/.test(word) ? word.length >= 2 : word.length >= 4 && !ignored.has(word),
      ),
  )
}

/**
 * A chat is handled by a reply naming it, or by a question or status from the same session,
 * after the chat was read, that refers to it. Other activity never counts.
 */
export function chatHandled(trace: QualificationTrace): ChatOutcome {
  const sent = Date.parse(trace.chat.created_at)
  const read = Math.max(sent, trace.readAt ? Date.parse(trace.readAt) : sent)
  const chatTerms = terms(trace.chat.text)
  const related = (text: string) => [...terms(text)].some((word) => chatTerms.has(word))
  for (const item of [...trace.outbox].sort(
    (a, b) => Date.parse(a.created_at) - Date.parse(b.created_at),
  )) {
    const at = Date.parse(item.created_at)
    if (item.session_id !== trace.chat.session_id || at < sent) {
      continue
    }
    if (
      item.kind === 'reply' &&
      'inbox_item_id' in item.payload &&
      item.payload.inbox_item_id === trace.chat.id
    ) {
      return { handled: true, by: 'reply' }
    }
    if (at < read) {
      continue
    }
    if (item.kind === 'status' && 'text' in item.payload && related(item.payload.text)) {
      return { handled: true, by: 'status' }
    }
    if (item.kind === 'question' && 'question_id' in item.payload) {
      const asked = trace.questions[item.payload.question_id]
      if (asked && related(`${asked.prompt} ${asked.reason} ${asked.assumption}`)) {
        return { handled: true, by: 'question' }
      }
    }
  }
  return { handled: false }
}
