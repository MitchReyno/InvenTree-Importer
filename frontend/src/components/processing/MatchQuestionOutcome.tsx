import type { MatchQuestionDto } from '@invimport/contracts'
import { Banner, EventTime, Link } from '#/components/ui'
import { answerWords } from '#/processing/match-question'

type Props = {
  question: MatchQuestionDto
  /** The lot's open question now, when a newer search replaced this one. */
  newerHref?: string
  /** This tab's answer was confirmed, before any read shows it answered. */
  savedHere: boolean
}

/** A match question that takes no new answer: what was decided, or that a newer search replaced it. */
export function MatchQuestionOutcome({ question, newerHref, savedHere }: Props) {
  const { answer } = question
  if (answer) {
    return (
      <div role="status" data-closed-question={question.id}>
        <Banner tone="ok">
          <b>{question.title}</b> You answered <EventTime at={answer.answered_at} />:{' '}
          {answerWords(question, answer)}
          {answer.batch && ', with the other exact matches'}.
        </Banner>
      </div>
    )
  }
  if (savedHere) {
    return (
      <div role="status" data-closed-question={question.id}>
        <Banner tone="ok">
          <b>{question.title}</b> Answer saved. Updating…
        </Banner>
      </div>
    )
  }

  return (
    <div role="status" data-closed-question={question.id}>
      <Banner tone="plain">
        <b>{question.title}</b> Replaced by a newer search.{' '}
        {newerHref && <Link href={newerHref}>Open the newer question</Link>}
      </Banner>
    </div>
  )
}
