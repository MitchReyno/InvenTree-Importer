import { useRef, type FormEvent } from 'react'
import { useForm } from 'react-hook-form'
import styled from 'styled-components'
import { space } from '#/theme/generated/tokens'
import {
  validate,
  type ProcessingAnswerDto,
  type ProcessingAnswerV1Dto,
  type ProcessingQuestionV1Dto,
} from '@invimport/contracts'
import { ANSWER_NOT_CONFIRMED, confirmedAnswerRefusal } from '#/processing/question-summary'
import { canSendNew, standingWarning, type QuestionStanding } from '#/processing/question-standing'
import { Small, Banner, QuestionCard, Button, DebugDetails } from '#/components/ui'
import { Fieldset, Input, Label, TextArea, OptionRow } from '#/forms'

export type SingleAnswerFormProps = {
  /** The question and capture revision this mount pinned. */
  question: ProcessingQuestionV1Dto
  captureRevision: string
  /** Whether the pinned question can still take a new answer, and why not. */
  standing: QuestionStanding
  disabled: boolean
  readOnly: boolean
  captureHref?: string
  label: string
  blockedReason?: string
  onDirtyChange: (dirty: boolean) => void
  answer: (questionId: string, input: ProcessingAnswerDto, key: string) => Promise<void>
}

interface AnswerFields {
  value: string
  basis: 'counted' | 'estimated'
}

interface AnswerSubmission {
  readonly questionId: string
  readonly input: ProcessingAnswerDto
  readonly key: string
}

const emptyAnswer: AnswerFields = { value: '', basis: 'counted' }

function validatedAnswerInput(
  question: ProcessingQuestionV1Dto,
  captureRevision: string,
  values: AnswerFields,
): ProcessingAnswerV1Dto {
  const typedValue: ProcessingAnswerV1Dto['value'] =
    question.spec.kind === 'quantity'
      ? { kind: 'quantity', value: values.value, basis: values.basis }
      : { kind: 'clarification', text: values.value }
  const input: ProcessingAnswerV1Dto = {
    schema_version: 'bench-intake-answer/1',
    expected_question_revision: question.revision,
    expected_capture_revision: captureRevision,
    attempt_id: question.attempt_id,
    input_sha256: question.input_sha256,
    value: typedValue,
  }
  validate('ProcessingAnswer', input)
  Object.freeze(input.value)
  return Object.freeze(input)
}

/**
 * An earlier runner question or a `/1` session question: one quantity or clarification, answered
 * through the earlier answer format.
 */
export function SingleAnswerForm({
  question,
  captureRevision,
  standing,
  disabled,
  readOnly,
  captureHref,
  label,
  blockedReason,
  onDirtyChange,
  answer,
}: SingleAnswerFormProps) {
  const {
    register,
    handleSubmit,
    getValues,
    reset,
    setError,
    clearErrors,
    setValue,
    watch,
    formState,
  } = useForm<AnswerFields>({ defaultValues: emptyAnswer })
  const submission = useRef<AnswerSubmission | null>(null)

  const retrying = submission.current !== null
  const stale = !canSendNew(standing)
  const hasCurrentDraft = !stale && formState.isDirty
  // The warning is for what the form holds; a clean form has nothing it can't send.
  const warning = formState.isDirty || retrying ? standingWarning(standing, retrying) : null
  const deliveryUnavailable = disabled || readOnly || formState.isSubmitting
  const submitDisabled = deliveryUnavailable || (!retrying && !hasCurrentDraft)
  // A session question reaches the running or resumable session; it never starts a continuation.
  let actionLabel = question.assumption
    ? 'Send answer to the session'
    : 'Save answer and queue continuation'
  if (formState.isSubmitting) {
    actionLabel = 'Saving answer…'
  } else if (retrying) {
    actionLabel = 'Try again'
  }
  const error = formState.errors.value?.message ?? formState.errors.root?.command?.message
  const errorId = `answer-error-${question.id}`

  function reportDirty(event: FormEvent<HTMLFormElement>) {
    const target = event.target
    const fieldEvent =
      target instanceof HTMLInputElement ||
      target instanceof HTMLSelectElement ||
      target instanceof HTMLTextAreaElement
    if (!fieldEvent) {
      return
    }
    if (submission.current) {
      onDirtyChange(true)
      return
    }
    const values = getValues()
    // Use the event value explicitly: navigation must see this edit before a later RHF render.
    const nextValue = target.name === 'value' ? target.value : values.value
    const nextBasis = target.name === 'basis' ? target.value : values.basis
    onDirtyChange(nextValue !== emptyAnswer.value || nextBasis !== emptyAnswer.basis)
  }

  function discard() {
    submission.current = null
    reset(emptyAnswer)
    onDirtyChange(false)
  }

  async function submit(values: AnswerFields) {
    if (disabled || readOnly) {
      return
    }
    let delivery = submission.current
    if (!delivery) {
      if (stale) {
        return
      }
      let input: ProcessingAnswerDto
      try {
        input = validatedAnswerInput(question, captureRevision, values)
      } catch {
        const message =
          question.spec.kind === 'quantity'
            ? 'Enter a positive exact quantity with at most six decimal places.'
            : 'Enter a clarification of up to 2048 characters.'
        setError('value', { type: 'contract', message })
        return
      }
      delivery = Object.freeze({ questionId: question.id, input, key: crypto.randomUUID() })
      submission.current = delivery
    }
    clearErrors()
    try {
      await answer(delivery.questionId, delivery.input, delivery.key)
      submission.current = null
      reset(emptyAnswer)
      onDirtyChange(false)
    } catch (failure) {
      if (confirmedAnswerRefusal(failure)) {
        // Nothing was saved, so the draft is editable again.
        // setError re-renders, so the form shows as editable again.
        submission.current = null
        setError('root.command', {
          type: 'server',
          message: 'The answer wasn\u2019t accepted. Check it and send again.',
        })
        return
      }
      setError('root.command', {
        type: 'server',
        message: ANSWER_NOT_CONFIRMED,
      })
    }
  }

  const basis = watch('basis')

  return (
    <Form aria-label={label} onChange={reportDirty} onSubmit={handleSubmit(submit)}>
      <QuestionCard
        question={question.spec.prompt}
        why={question.spec.reason}
        assumption={
          question.assumption
            ? `The agent keeps working on this assumption: ${question.assumption}`
            : 'Work on this waits for your answer.'
        }
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
            <Fieldset disabled={formState.isSubmitting || readOnly || retrying}>
              <Field>
                <Label htmlFor={`answer-${question.id}`}>
                  {question.spec.kind === 'quantity' ? 'Quantity' : 'Clarification'}
                </Label>
                {question.spec.kind === 'quantity' ? (
                  <Input
                    id={`answer-${question.id}`}
                    inputMode="decimal"
                    required
                    aria-invalid={Boolean(formState.errors.value)}
                    aria-describedby={error ? errorId : undefined}
                    {...register('value')}
                  />
                ) : (
                  <TextArea
                    id={`answer-${question.id}`}
                    maxLength={2048}
                    required
                    aria-invalid={Boolean(formState.errors.value)}
                    aria-describedby={error ? errorId : undefined}
                    {...register('value')}
                  />
                )}
              </Field>
              {question.spec.kind === 'quantity' && (
                <OptionRow
                  name="basis"
                  legend="How was the quantity determined?"
                  options={[{ id: 'counted', title: 'Counted', detail: 'Every item counted' }]}
                  escape={{ id: 'estimated', title: 'Estimated', detail: 'An approximate count' }}
                  value={basis}
                  onChange={(id) =>
                    setValue('basis', id as AnswerFields['basis'], { shouldDirty: true })
                  }
                />
              )}
              {error && (
                <div id={errorId} role="alert">
                  <Banner tone="bad">{error}</Banner>
                </div>
              )}
            </Fieldset>
            {blockedReason && <Small>{blockedReason}</Small>}
            <Actions>
              <Button variant="primary" disabled={submitDisabled} type="submit">
                {actionLabel}
              </Button>
              {(formState.isDirty || retrying) && (
                <Button type="button" disabled={formState.isSubmitting} onClick={discard}>
                  Discard unsaved answer
                </Button>
              )}
            </Actions>
            <Small>
              {question.assumption
                ? 'Your answer updates the saved lot or note, and the agent working on it reads it.'
                : 'Your answer updates the saved lot or note, and a continuation is queued for the agent.'}
            </Small>
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
    </Form>
  )
}

const Form = styled.form`
  display: grid;
  gap: ${space[3]};
  min-width: 0;
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

const Field = styled.div`
  display: grid;
  gap: ${space[4]};
`
