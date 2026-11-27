import { useEffect, useRef } from 'react'
import type { MatchAnswerDto, MatchQuestionDto } from '@invimport/contracts'
import {
  matchAnswerInput,
  matchAnswerRefusal,
  matchQuestionView,
  matchStanding,
} from '#/processing/match-question'
import { MatchQuestionDetails } from './MatchQuestionDetails'
import { SteppedAnswerForm } from './SteppedAnswerForm'

type Props = {
  /** The question as this mount first read it; the form stays pinned to it. */
  question: MatchQuestionDto
  /** The same question in the latest Match read, if it is still there. */
  current: MatchQuestionDto | undefined
  /** This form's own answer was confirmed, though no read may show it answered yet. */
  answeredHere: boolean
  lot: string
  source?: string
  disabled: boolean
  readOnly: boolean
  blockedReason?: string
  onDirtyChange: (dirty: boolean) => void
  answer: (questionId: string, input: MatchAnswerDto, key: string) => Promise<void>
}

/**
 * A match question answered through the same stepped form as an agent's question, with its
 * candidates above the options. It is the app's question: nothing reads it but Match.
 */
export function MatchQuestionForm({
  question: requested,
  current,
  answeredHere,
  lot,
  source,
  disabled,
  readOnly,
  blockedReason,
  onDirtyChange,
  answer,
}: Props) {
  const question = useRef(requested).current
  const dirtyObserver = useRef(onDirtyChange)
  dirtyObserver.current = onDirtyChange
  useEffect(() => () => dirtyObserver.current(false), [])

  return (
    <div data-question-form={question.id}>
      <SteppedAnswerForm
        questionId={question.id}
        view={matchQuestionView(question)}
        standing={matchStanding(question, current, answeredHere)}
        disabled={disabled}
        readOnly={readOnly}
        pictures={<MatchQuestionDetails question={question} lot={lot} source={source} />}
        label={`Match question: ${question.title}`}
        blockedReason={blockedReason}
        assumptionText={(assumption) => assumption}
        consequence="Your answer sets what Research and Images do for this lot. It changes nothing in InvenTree."
        debugRows={[
          { label: 'Question', value: question.id },
          { label: 'Search generation', value: question.revision },
        ]}
        buildInput={(drafts) => matchAnswerInput(question, drafts)}
        refusalOf={matchAnswerRefusal}
        onDirtyChange={onDirtyChange}
        answer={answer}
      />
    </div>
  )
}
