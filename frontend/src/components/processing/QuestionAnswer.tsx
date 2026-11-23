import { useEffect, useRef } from 'react'
import type { ProcessingAnswerDto, ProcessingQuestionDto } from '@invimport/contracts'
import { SingleAnswerForm } from './SingleAnswerForm'
import { SteppedAnswerForm } from './SteppedAnswerForm'

interface Props {
  question: ProcessingQuestionDto
  captureRevision: string
  currentQuestion: ProcessingQuestionDto | undefined
  currentCaptureRevision: string
  disabled: boolean
  readOnly?: boolean
  /** Where to add evidence for this question, offered as "Add a photo". */
  captureHref?: string
  /** The form's accessible name; a session drawer's answer form names itself apart. */
  label?: string
  /** Why the answer can't be sent now, while another draft must be saved or discarded first. */
  blockedReason?: string
  onDirtyChange: (dirty: boolean) => void
  answer: (questionId: string, input: ProcessingAnswerDto, key: string) => Promise<void>
}

/**
 * Mount identity is pinned. Polling changes current validity, never the editing target or fields.
 * A `/2` question is answered step by step; an earlier one through its single-value form.
 */
export function QuestionAnswer({
  question: requestedQuestion,
  captureRevision: requestedCaptureRevision,
  currentQuestion,
  currentCaptureRevision,
  disabled,
  readOnly = false,
  captureHref,
  label = 'Pinned application question',
  blockedReason,
  onDirtyChange,
  answer,
}: Props) {
  const { question, captureRevision } = useRef({
    question: requestedQuestion,
    captureRevision: requestedCaptureRevision,
  }).current
  const dirtyObserver = useRef(onDirtyChange)
  dirtyObserver.current = onDirtyChange
  useEffect(() => () => dirtyObserver.current(false), [])

  const stale =
    !currentQuestion ||
    currentQuestion.id !== question.id ||
    currentQuestion.state !== 'open' ||
    currentQuestion.revision !== question.revision ||
    currentQuestion.attempt_id !== question.attempt_id ||
    currentQuestion.input_sha256 !== question.input_sha256 ||
    currentCaptureRevision !== captureRevision
  const shared = {
    captureRevision,
    stale,
    disabled,
    readOnly,
    captureHref,
    label,
    blockedReason,
    onDirtyChange,
    answer,
  }

  return 'steps' in question ? (
    <SteppedAnswerForm question={question} {...shared} />
  ) : (
    <SingleAnswerForm question={question} {...shared} />
  )
}
