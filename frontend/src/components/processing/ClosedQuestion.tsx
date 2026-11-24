import { questionView, type ProcessingQuestionDto } from '@invimport/contracts'
import { Banner, Link } from '#/components/ui'

/**
 * A question that closed without an answer: replaced by a later question of its session, which it
 * links, or otherwise no longer asked, linking the session rather than any other question.
 */
export function ClosedQuestion({
  question,
  replacementHref,
  sessionHref,
}: {
  question: ProcessingQuestionDto
  /** The question that replaced it, when one did. */
  replacementHref?: string
  /** The job's session page, when its history exists. */
  sessionHref?: string
}) {
  const title = questionView(question).title

  return (
    <div role="status" data-closed-question={question.id}>
      <Banner tone="plain">
        <b>{title}</b>{' '}
        {replacementHref ? (
          <>
            Replaced by a newer question.{' '}
            <Link href={replacementHref}>Open the newer question</Link>
          </>
        ) : (
          <>
            No longer asked. {sessionHref && <Link href={sessionHref}>See it in the session</Link>}
          </>
        )}
      </Banner>
    </div>
  )
}
