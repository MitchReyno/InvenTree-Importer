import { useEffect, useRef } from 'react'
import {
  questionView,
  type ProcessingAnswerDto,
  type ProcessingQuestionDto,
} from '@invimport/contracts'
import { batchHref } from '#/navigation/batch-route'
import { questionStanding } from '#/processing/question-standing'
import { confirmedAnswerRefusal } from '#/processing/question-summary'
import { steppedAnswerInput } from '#/processing/stepped-answer'
import { QuestionFigures } from './QuestionFigures'
import { SingleAnswerForm } from './SingleAnswerForm'
import { SteppedAnswerForm, type SteppedRefusal } from './SteppedAnswerForm'

interface Props {
  /** The batch the question belongs to, whose routes serve its pictures. */
  batchId: string
  question: ProcessingQuestionDto
  captureRevision: string
  currentQuestion: ProcessingQuestionDto | undefined
  currentCaptureRevision: string
  disabled: boolean
  readOnly?: boolean
  /** Where to add evidence for this question, offered as "Add a photo". */
  captureHref?: string
  /** The lot the question is about, which a picture's larger view names. */
  lot?: string
  /** The form's accessible name; a session drawer's answer form names itself apart. */
  label?: string
  /** Why the answer can't be sent now, while another draft must be saved or discarded first. */
  blockedReason?: string
  /** This form's own answer was confirmed, though no read may show it answered yet. */
  answeredHere?: boolean
  onDirtyChange: (dirty: boolean) => void
  answer: (questionId: string, input: ProcessingAnswerDto, key: string) => Promise<void>
}

/**
 * Mount identity is pinned. Polling changes current validity, never the editing target or fields.
 * A `/2` question is answered step by step; an earlier one through its single-value form.
 */
export function QuestionAnswer({
  batchId,
  question: requestedQuestion,
  captureRevision: requestedCaptureRevision,
  currentQuestion,
  currentCaptureRevision,
  disabled,
  readOnly = false,
  captureHref,
  lot,
  label = 'Pinned application question',
  blockedReason,
  answeredHere = false,
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

  const standing = questionStanding({
    pinned: question,
    pinnedCaptureRevision: captureRevision,
    current: currentQuestion,
    currentCaptureRevision,
    answeredHere,
  })
  const shared = {
    standing,
    disabled,
    readOnly,
    captureHref,
    label,
    blockedReason,
    onDirtyChange,
    answer,
  }

  if ('steps' in question) {
    // The pictures follow the latest read of the pinned question, so a picture being made shows
    // once it is ready; the form itself stays pinned.
    const latest = currentQuestion?.id === question.id ? currentQuestion : undefined
    const figures = (latest && 'steps' in latest ? latest.figures : undefined) ?? question.figures
    const pictures = figures && (
      <QuestionFigures
        figures={figures}
        batchId={batchId}
        jobId={question.job_id}
        questionId={question.id}
        questionTitle={questionView(question).title}
        lot={lot}
        captureHref={captureHref ?? batchHref(batchId, { tab: 'capture' })}
      />
    )
    return (
      <SteppedAnswerForm
        questionId={question.id}
        view={questionView(question)}
        pictures={pictures}
        assumptionText={(assumption) => `The agent keeps working on this assumption: ${assumption}`}
        consequence="Your answer updates the saved lot or note, and the agent working on it reads it."
        debugRows={[
          { label: 'Attempt', value: question.attempt_id },
          { label: 'Question revision', value: question.revision },
        ]}
        buildInput={(drafts) => steppedAnswerInput(question, captureRevision, drafts)}
        refusalOf={sessionAnswerRefusal}
        {...shared}
      />
    )
  }

  return <SingleAnswerForm question={question} captureRevision={captureRevision} {...shared} />
}

/** A `/2` answer the server refused as invalid, naming the step it refused when it names one. */
function sessionAnswerRefusal(failure: unknown): SteppedRefusal | null {
  const refused = confirmedAnswerRefusal(failure)

  return refused ? { kind: 'invalid', stepId: refused.stepId } : null
}
