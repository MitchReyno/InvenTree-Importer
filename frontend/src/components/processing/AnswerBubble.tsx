import type { SessionHistoryEntryDto } from '@invimport/contracts'
import { Link } from '#/components/ui'
import { batchHref } from '#/navigation/batch-route'
import { answerEffectsText, answerPayloadText } from '#/processing/question-summary'
import { ChatBubble } from './ChatBubble'
import type { HistoryContext } from './HistoryLink'
import { HistoryLinks } from './HistoryLinks'
import { STEP_LABEL } from './ProcessingParts'

/** An answer as the operator's bubble, quoting the question it answers with a link to it. */
export function AnswerBubble({
  entry,
  context,
}: {
  entry: SessionHistoryEntryDto
  context: HistoryContext
}) {
  if (entry.details.kind !== 'answer') {
    return null
  }
  const asker = STEP_LABEL[context.step] ?? 'The agent'
  // The question link is the quote; the rest, such as the lot, follow the answer.
  const lotLinks = entry.links.filter((candidate) => candidate.kind !== 'question')
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
      links={lotLinks.length > 0 && <HistoryLinks links={lotLinks} context={context} />}
    />
  )
}
