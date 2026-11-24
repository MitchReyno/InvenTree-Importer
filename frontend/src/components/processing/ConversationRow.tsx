import type { ReactNode } from 'react'
import styled from 'styled-components'
import type { SessionHistoryEntryDto } from '@invimport/contracts'
import type { FailureLoader } from '#/components/agents/SessionFailureDetails'
import { Link } from '#/components/ui'
import { batchHref } from '#/navigation/batch-route'
import type { ConversationItem } from '#/processing/session-history'
import { answerEffectsText, answerPayloadText } from '#/processing/question-summary'
import { color, radius, space } from '#/theme/generated/tokens'
import { AttemptDivider, type FreshAction } from './AttemptDivider'
import { ChatBubble } from './ChatBubble'
import { HistoryEntry } from './HistoryEntry'
import type { HistoryContext } from './HistoryLink'
import { HistoryRow } from './HistoryRow'
import { STEP_LABEL } from './ProcessingParts'

export type ConversationRowProps = {
  item: ConversationItem
  context: HistoryContext
  /**
   * The form that answers a question in place, on the session page; it keeps an unsaved draft
   * after it closes. The drawer answers above its history, so it has none.
   */
  answerForm?: (questionId: string) => ReactNode
  loadFailure?: FailureLoader
  /** Start fresh beside the current attempt's failure, where one is offered. */
  startFresh?: FreshAction
}

/** An answer as the operator's bubble, quoting the question it answers with a link to it. */
function AnswerBubble({ entry, context }: { entry: SessionHistoryEntryDto; context: HistoryContext }) {
  if (entry.details.kind !== 'answer') {
    return null
  }
  const asker = STEP_LABEL[context.step] ?? 'The agent'
  const link = entry.links.find((candidate) => candidate.kind === 'question')
  const question =
    link?.kind === 'question' ? (
      <Link
        href={batchHref(context.batchId, {
          tab: 'processing',
          step: context.step,
          questionId: link.question_id,
        })}
      >
        {link.label}
      </Link>
    ) : (
      <span>A question no longer listed</span>
    )

  return (
    <ChatBubble
      id={entry.id}
      mine
      author="You"
      text={answerPayloadText(entry.details.answer)}
      at={entry.at}
      unread={entry.who !== 'agent' && !entry.read}
      quote={{ asker, question }}
      note={answerEffectsText(entry.details.effects) || undefined}
    />
  )
}

/** One row of a session's history: a divider, a chat bubble, a question card or a history row. */
export function ConversationRow({
  item,
  context,
  answerForm,
  loadFailure,
  startFresh,
}: ConversationRowProps) {
  if (item.kind === 'attempt') {
    return (
      <AttemptDivider
        attempt={item.attempt}
        loadFailure={loadFailure}
        startFresh={startFresh?.attemptId === item.attempt.id ? startFresh : undefined}
      />
    )
  }
  if (item.kind !== 'entry') {
    return <HistoryRow item={item} context={context} />
  }
  const { entry } = item
  const { details } = entry
  if (details.kind === 'chat' || details.kind === 'reply') {
    const mine = entry.who !== 'agent'
    return (
      <ChatBubble
        id={entry.id}
        mine={mine}
        author={mine ? 'You' : (STEP_LABEL[context.step] ?? 'Agent')}
        text={details.text}
        at={entry.at}
        unread={mine && !entry.read}
      />
    )
  }
  if (details.kind === 'answer') {
    return <AnswerBubble entry={entry} context={context} />
  }
  if (details.kind === 'question' && answerForm) {
    return (
      <Card>
        <HistoryEntry entry={entry} context={context} />
        {answerForm(details.question_id)}
      </Card>
    )
  }
  return <HistoryEntry entry={entry} context={context} />
}

const Card = styled.div`
  display: grid;
  gap: ${space[4]};
  padding: ${space[4]};
  border: 1px solid ${color.line};
  border-radius: ${radius.card};
  background: ${color.surface};
  min-width: 0;
`
