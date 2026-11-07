import type { SessionOutboxItemDto } from '@invimport/contracts'

type Outbox = Pick<SessionOutboxItemDto, 'session_id' | 'created_at' | 'kind' | 'payload'>
export interface QualificationTrace {
  chat: { id: string; session_id: string; created_at: string; text: string }
  /** When the session was observed to read the chat; without it, matches stay unverified. */
  readAt?: string
  outbox: Outbox[]
  questions: Record<string, { prompt: string; reason: string; assumption: string }>
}
export type ChatOutcome =
  | { handled: true; by: 'reply' }
  | { handled: true | 'unverified'; by: 'question' | 'status'; matched: string[] }
  | { handled: false }

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

function itemText(item: Outbox, questions: QualificationTrace['questions']) {
  if ((item.kind === 'status' || item.kind === 'reply') && 'text' in item.payload) {
    return item.payload.text
  }
  if (item.kind === 'question' && 'question_id' in item.payload) {
    const asked = questions[item.payload.question_id]
    return asked ? `${asked.prompt} ${asked.reason} ${asked.assumption}` : ''
  }
  return ''
}

/**
 * A chat is handled by a reply naming it, or by a question or status from the same session,
 * after the chat was read, that takes up the chat's own content: a number from it, or two of its
 * words, that the session had not already used. Other activity never counts. Matched terms are
 * returned so a reviewer can confirm them.
 */
export function chatHandled(trace: QualificationTrace): ChatOutcome {
  const sent = Date.parse(trace.chat.created_at)
  const read = trace.readAt ? Math.max(sent, Date.parse(trace.readAt)) : sent
  const own = trace.outbox
    .filter((item) => item.session_id === trace.chat.session_id)
    .sort((a, b) => Date.parse(a.created_at) - Date.parse(b.created_at))
  const earlier = new Set(
    own
      .filter((item) => Date.parse(item.created_at) < sent)
      .flatMap((item) => [...terms(itemText(item, trace.questions))]),
  )
  const chatTerms = [...terms(trace.chat.text)].filter((word) => !earlier.has(word))
  for (const item of own) {
    const at = Date.parse(item.created_at)
    if (at < sent) {
      continue
    }
    if (
      item.kind === 'reply' &&
      'inbox_item_id' in item.payload &&
      item.payload.inbox_item_id === trace.chat.id
    ) {
      return { handled: true, by: 'reply' }
    }
    if (at < read || (item.kind !== 'status' && item.kind !== 'question')) {
      continue
    }
    const said = terms(itemText(item, trace.questions))
    const matched = chatTerms.filter((word) => said.has(word)).sort()
    if (matched.some((word) => /\d/.test(word)) || matched.length >= 2) {
      return { handled: trace.readAt ? true : 'unverified', by: item.kind, matched }
    }
  }
  return { handled: false }
}
