import { useEffect, useRef, useState } from 'react'
import { useForm } from 'react-hook-form'
import styled from 'styled-components'
import {
  questionView,
  type ProcessingAnswerDto,
  type ProcessingQuestionV2Dto,
  type QuestionViewStep,
} from '@invimport/contracts'
import { Banner, Button, DebugDetails, QuestionCard, Small } from '#/components/ui'
import { Fieldset } from '#/forms'
import { color, space, typeVar } from '#/theme/generated/tokens'
import { confirmedAnswerRefusal, stepAnswerText } from '#/processing/question-summary'
import {
  draftStarted,
  emptyDraft,
  stepComplete,
  steppedAnswerInput,
  stepValue,
  type StepDraft,
  type SteppedFields,
} from '#/processing/stepped-answer'
import { StepInput } from './StepInput'

export type SteppedAnswerFormProps = {
  /** The question and capture revision this mount pinned. */
  question: ProcessingQuestionV2Dto
  captureRevision: string
  /** The pinned question is no longer the current open one, or the capture moved on. */
  stale: boolean
  disabled: boolean
  readOnly: boolean
  captureHref?: string
  label: string
  blockedReason?: string
  onDirtyChange: (dirty: boolean) => void
  answer: (questionId: string, input: ProcessingAnswerDto, key: string) => Promise<void>
}

interface Submission {
  readonly questionId: string
  readonly input: ProcessingAnswerDto
  readonly key: string
}

/** Which step shows, or the check-your-answers summary before a stepped question is sent. */
type Position = number | 'review'

type Refusal = { stepId?: string; message: string }

const STEP_REFUSED = 'This answer wasn’t accepted. Check it and send again.'
const ANSWER_REFUSED = 'The answer wasn’t accepted. Check your answers and send again.'
const NOT_CONFIRMED =
  'Answer not confirmed. Your answer may already be saved. Retry sends only this original answer; discard clears only the local draft.'

/**
 * A `/2` question answered one step at a time: one step shows its answer and Send; several show
 * "Step N of M" with Back and Next, then a summary, and send every step in one answer.
 */
export function SteppedAnswerForm({
  question,
  captureRevision,
  stale,
  disabled,
  readOnly,
  captureHref,
  label,
  blockedReason,
  onDirtyChange,
  answer,
}: SteppedAnswerFormProps) {
  const view = questionView(question)
  const steps = view.steps
  const stepped = steps.length > 1

  const empty = () => ({ steps: steps.map(emptyDraft) })

  const { handleSubmit, getValues, reset, register, control, watch, formState } =
    useForm<SteppedFields>({
      defaultValues: empty(),
    })
  const drafts = watch('steps')
  const [position, setPosition] = useState<Position>(0)
  const [refusal, setRefusal] = useState<Refusal | null>(null)
  const [unconfirmed, setUnconfirmed] = useState(false)
  const submission = useRef<Submission | null>(null)
  const body = useRef<HTMLDivElement>(null)
  const moved = useRef(false)

  // Moving between steps puts focus on the new step's first control, as a page turn would.
  useEffect(() => {
    if (!moved.current) {
      return
    }
    moved.current = false
    body.current?.querySelector<HTMLElement>('input, textarea, button')?.focus()
  }, [position])

  const retrying = submission.current !== null
  const started = drafts.some(draftStarted)
  const locked = formState.isSubmitting || readOnly || retrying
  const complete = drafts.every(stepComplete)
  const sendDisabled =
    disabled || readOnly || formState.isSubmitting || (!retrying && (stale || !complete))

  function stepEdited() {
    setRefusal(null)
    // Report from the edit itself, so navigation sees it before the next render.
    onDirtyChange(getValues('steps').some(draftStarted))
  }

  function moveTo(next: Position) {
    moved.current = true
    setPosition(next)
  }

  function discard() {
    submission.current = null
    reset(empty())
    setRefusal(null)
    setUnconfirmed(false)
    moveTo(0)
    onDirtyChange(false)
  }

  async function send() {
    if (disabled || readOnly) {
      return
    }
    let delivery = submission.current
    if (!delivery) {
      if (stale || !complete) {
        return
      }
      const input = steppedAnswerInput(question, captureRevision, getValues('steps'))
      delivery = Object.freeze({ questionId: question.id, input, key: crypto.randomUUID() })
      submission.current = delivery
    }
    setRefusal(null)
    setUnconfirmed(false)
    try {
      await answer(delivery.questionId, delivery.input, delivery.key)
      submission.current = null
      reset(empty())
      onDirtyChange(false)
    } catch (failure) {
      const refused = confirmedAnswerRefusal(failure)
      if (!refused) {
        // The outcome is unknown: only this exact answer, under its key, may be sent again.
        setUnconfirmed(true)
        return
      }
      // Nothing was saved, so the draft is editable again and the named step shows why.
      submission.current = null
      const index = steps.findIndex((step) => step.id === refused.stepId)
      if (index >= 0) {
        moveTo(index)
        setRefusal({ stepId: refused.stepId, message: STEP_REFUSED })
      } else {
        setRefusal({ message: ANSWER_REFUSED })
      }
    }
  }

  function submit() {
    // Enter on a step moves on rather than sending a question with steps still to check.
    if (stepped && position !== 'review') {
      if (stepComplete(drafts[position])) {
        moveTo(position === steps.length - 1 ? 'review' : position + 1)
      }
      return
    }
    return send()
  }

  let sendLabel = stepped ? `Send ${steps.length} answers` : 'Send answer'
  if (formState.isSubmitting) {
    sendLabel = 'Saving answer…'
  } else if (retrying) {
    sendLabel = 'Retry exact answer'
  }
  const current = position === 'review' ? undefined : steps[position]
  const progress =
    position === 'review' ? 'Check your answers' : `Step ${position + 1} of ${steps.length}`

  return (
    <Form aria-label={label} onSubmit={handleSubmit(submit)}>
      <QuestionCard
        context={
          stepped && (
            <Progress>
              <b>{view.title}</b>
              <span>{progress}</span>
            </Progress>
          )
        }
        question={current ? current.prompt : view.title}
        why={view.reason}
        assumption={
          current?.assumption
            ? `The agent keeps working on this assumption: ${current.assumption}`
            : undefined
        }
        answer={
          <>
            {stale && (
              <div role="status">
                <Banner tone="warn">
                  {retrying
                    ? 'The saved question context changed. Retry only the original unconfirmed answer, or discard the local draft.'
                    : 'This question is superseded or its saved context changed. Your unsaved answer is preserved; it cannot be applied to another question.'}
                </Banner>
              </div>
            )}
            <Fieldset disabled={locked}>
              <div ref={body}>
                {current && position !== 'review' ? (
                  <StepInput
                    key={current.id}
                    step={current}
                    index={position}
                    draft={drafts[position]}
                    register={register}
                    control={control}
                    idPrefix={`answer-${question.id}-${current.id}`}
                    onEdited={stepEdited}
                    refusal={refusal?.stepId === current.id ? refusal.message : undefined}
                  />
                ) : (
                  <Summary aria-label="Your answers">
                    {steps.map((step, index) => (
                      <SummaryRow key={step.id}>
                        <dt>
                          {step.prompt}
                          {step.assumption && (
                            <Assuming>Assuming until sent: {step.assumption}</Assuming>
                          )}
                        </dt>
                        <dd>
                          <b>{summaryText(step, drafts[index])}</b>
                          <Button
                            type="button"
                            size="sm"
                            variant="ghost"
                            aria-label={`Change: ${step.prompt}`}
                            onClick={() => moveTo(index)}
                          >
                            Change
                          </Button>
                        </dd>
                      </SummaryRow>
                    ))}
                  </Summary>
                )}
              </div>
            </Fieldset>
            {refusal && !refusal.stepId && (
              <div role="alert">
                <Banner tone="bad">{refusal.message}</Banner>
              </div>
            )}
            {unconfirmed && (
              <div role="alert">
                <Banner tone="bad">{NOT_CONFIRMED}</Banner>
              </div>
            )}
            {blockedReason && <Small>{blockedReason}</Small>}
            <Actions>
              {stepped && position !== 0 && (
                <Button
                  type="button"
                  disabled={locked}
                  onClick={() => moveTo(position === 'review' ? steps.length - 1 : position - 1)}
                >
                  Back
                </Button>
              )}
              {stepped && position !== 'review' ? (
                <Button
                  variant="primary"
                  type="submit"
                  disabled={locked || !stepComplete(drafts[position])}
                >
                  Next
                </Button>
              ) : (
                <Button variant="primary" type="submit" disabled={sendDisabled}>
                  {sendLabel}
                </Button>
              )}
              {(started || retrying) && (
                <Button type="button" disabled={formState.isSubmitting} onClick={discard}>
                  Discard unsaved answer
                </Button>
              )}
            </Actions>
          </>
        }
        secondary={
          captureHref && (
            <Ghosts>
              <Button as="a" variant="ghost" size="sm" href={captureHref}>
                Add a photo
              </Button>
            </Ghosts>
          )
        }
      />
      <DebugDetails
        label="Question identity"
        rows={[
          { label: 'Attempt', value: question.attempt_id },
          { label: 'Question revision', value: question.revision },
        ]}
      />
      <Small>This human answer updates the saved lot or note and reaches the agent session.</Small>
    </Form>
  )
}

/** A step's answer as the summary shows it: "380 · estimated", an option's label, or the words. */
function summaryText(step: QuestionViewStep, draft: StepDraft) {
  const value = stepValue(draft)
  if (value.kind === 'number') {
    return `${value.value} · ${value.basis}`
  }
  const options = step.answer.kind === 'choice' ? step.answer.options : []

  return stepAnswerText(value, (id) => options.find((option) => option.id === id)?.label ?? id)
}

const Form = styled.form`
  display: grid;
  gap: ${space[3]};
  min-width: 0;
`

const Progress = styled.span`
  display: flex;
  flex-wrap: wrap;
  justify-content: space-between;
  gap: ${space[4]};
  font-size: ${typeVar.small.size};
  span {
    color: ${color.muted};
  }
`

const Summary = styled.dl`
  display: grid;
  margin: 0;
`

const SummaryRow = styled.div`
  display: grid;
  /* A long unbroken answer, such as a pasted URL, wraps instead of widening the drawer. */
  grid-template-columns: minmax(0, 1fr);
  gap: ${space[1]};
  padding: ${space[4]} 0;
  border-top: 1px solid ${color.line};
  dt {
    font-size: ${typeVar.small.size};
    color: ${color.muted};
  }
  dd {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: space-between;
    gap: ${space[4]};
    margin: 0;
  }
  dt,
  dd b {
    min-width: 0;
    overflow-wrap: anywhere;
  }
`

const Assuming = styled.span`
  display: block;
`

const Actions = styled.div`
  display: flex;
  flex-wrap: wrap;
  gap: ${space[4]};
`

const Ghosts = styled.div`
  display: flex;
  flex-wrap: wrap;
  gap: ${space[3]};
`
