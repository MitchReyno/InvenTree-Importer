import { useEffect, useRef, useState, type ReactNode } from 'react'
import { useForm } from 'react-hook-form'
import styled from 'styled-components'
import type { QuestionView, QuestionViewStep } from '@invimport/contracts'
import { Banner, Button, DebugDetails, QuestionCard, Small } from '#/components/ui'
import { Fieldset } from '#/forms'
import { color, space, typeVar } from '#/theme/generated/tokens'
import { ANSWER_NOT_CONFIRMED, stepAnswerText } from '#/processing/question-summary'
import { canSendNew, standingWarning, type QuestionStanding } from '#/processing/question-standing'
import {
  draftStarted,
  emptyDraft,
  stepComplete,
  stepValue,
  type StepDraft,
  type SteppedFields,
} from '#/processing/stepped-answer'
import { StepInput } from './StepInput'

/**
 * A send the server read and refused, so nothing was saved: a step it names, the whole answer, or
 * a question that moved on (`stale`), whose draft is kept but can't be sent again.
 */
export type SteppedRefusal = { kind: 'invalid'; stepId?: string } | { kind: 'stale' }

export type SteppedAnswerFormProps<Input> = {
  /** The pinned question's id and how it reads: its title, reason and steps. */
  questionId: string
  view: QuestionView
  /** Whether the pinned question can still take a new answer, and why not. */
  standing: QuestionStanding
  disabled: boolean
  readOnly: boolean
  captureHref?: string
  /** Shown above the answer: an agent's pictures, or Match's candidates. */
  pictures?: ReactNode
  label: string
  blockedReason?: string
  /** How a step's assumption reads while the question is open. */
  assumptionText: (assumption: string) => string
  /** What sending the answer does, beside Send. */
  consequence: string
  debugRows: { label: string; value: string }[]
  /** The answer the drafts make, checked against its contract. */
  buildInput: (drafts: readonly StepDraft[]) => Input
  /** A failure the server confirmed refusing, or null when the outcome is unknown. */
  refusalOf: (failure: unknown) => SteppedRefusal | null
  onDirtyChange: (dirty: boolean) => void
  answer: (questionId: string, input: Input, key: string) => Promise<void>
}

interface Submission<Input> {
  readonly questionId: string
  readonly input: Input
  readonly key: string
}

/** Which step shows, or the check-your-answers summary before a stepped question is sent. */
type Position = number | 'review'

type Refusal = { stepId?: string; message: string }

const STEP_REFUSED = 'This answer wasn’t accepted. Check it and send again.'
const ANSWER_REFUSED = 'The answer wasn’t accepted. Check your answers and send again.'

/**
 * A stepped question answered one step at a time: one step shows its answer and Send; several show
 * "Step N of M" with Back and Next, then a summary, and send every step in one answer. A `/2`
 * session question and a match question share it, each with its own answer and refusals.
 */
export function SteppedAnswerForm<Input>({
  questionId,
  view,
  standing,
  disabled,
  readOnly,
  captureHref,
  pictures,
  label,
  blockedReason,
  assumptionText,
  consequence,
  debugRows,
  buildInput,
  refusalOf,
  onDirtyChange,
  answer,
}: SteppedAnswerFormProps<Input>) {
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
  // The server refused the send because the question moved on; the draft stays, unsendable.
  const [refusedStale, setRefusedStale] = useState(false)
  const submission = useRef<Submission<Input> | null>(null)
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
  const shownStanding = refusedStale ? 'closed' : standing
  const stale = !canSendNew(shownStanding)
  const started = drafts.some(draftStarted)
  // The warning is for what the form holds; a clean form has nothing it can't send.
  const warning = started || retrying ? standingWarning(shownStanding, retrying) : null
  const locked = formState.isSubmitting || readOnly || retrying
  const complete = drafts.every(stepComplete)
  // Next only moves through the draft; the consequence line belongs beside Send.
  const advancing = stepped && position !== 'review'
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
    setRefusedStale(false)
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
      const input = buildInput(getValues('steps'))
      delivery = Object.freeze({ questionId, input, key: crypto.randomUUID() })
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
      const refused = refusalOf(failure)
      if (!refused) {
        // The outcome is unknown: only this exact answer, under its key, may be sent again.
        setUnconfirmed(true)
        return
      }
      // Nothing was saved, so the draft is editable again and the named step shows why.
      submission.current = null
      if (refused.kind === 'stale') {
        setRefusedStale(true)
        return
      }
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
    sendLabel = 'Try again'
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
        question={stepped && current ? current.prompt : view.title}
        why={view.reason}
        pictures={pictures}
        assumption={current?.assumption ? assumptionText(current.assumption) : undefined}
        answer={
          <>
            {warning && (
              <div role="status">
                <Banner tone="warn">{warning}</Banner>
              </div>
            )}
            {formState.isSubmitting && (
              <Small role="status">Sending… the form stays locked until the answer is saved.</Small>
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
                    idPrefix={`answer-${questionId}-${current.id}`}
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
                <Banner tone="bad">{ANSWER_NOT_CONFIRMED}</Banner>
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
              {advancing ? (
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
            {!advancing && <Small>{consequence}</Small>}
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
      <DebugDetails label="Question identity" rows={debugRows} />
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
  align-items: center;
  gap: ${space[4]};
`

const Ghosts = styled.div`
  display: flex;
  flex-wrap: wrap;
  gap: ${space[3]};
`
