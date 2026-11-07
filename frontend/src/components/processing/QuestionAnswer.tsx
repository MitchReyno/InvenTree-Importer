import { useEffect, useRef, type FormEvent } from 'react'
import { useForm } from 'react-hook-form'
import styled from 'styled-components'
import { color } from '../../theme/generated/tokens'
import {
  validate,
  type ProcessingAnswerDto,
  type ProcessingQuestionDto,
} from '@invimport/contracts'
import {
  ErrorNotice,
  Fieldset,
  Input,
  Label,
  Notice,
  Paragraph,
  Select,
  Small,
  TextArea,
} from '../ui/primitives'
import { Button } from '../ui/Button'

interface Props {
  question: ProcessingQuestionDto
  captureRevision: string
  currentQuestion: ProcessingQuestionDto | undefined
  currentCaptureRevision: string
  disabled: boolean
  readOnly?: boolean
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
  question: ProcessingQuestionDto,
  captureRevision: string,
  values: AnswerFields,
): ProcessingAnswerDto {
  const typedValue: ProcessingAnswerDto['value'] =
    question.spec.kind === 'quantity'
      ? { kind: 'quantity', value: values.value, basis: values.basis }
      : { kind: 'clarification', text: values.value }
  const input: ProcessingAnswerDto = {
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

/** Mount identity is pinned. Polling changes current validity, never the editing target or fields. */
export function QuestionAnswer({
  question: requestedQuestion,
  captureRevision: requestedCaptureRevision,
  currentQuestion,
  currentCaptureRevision,
  disabled,
  readOnly = false,
  onDirtyChange,
  answer,
}: Props) {
  const { question, captureRevision } = useRef({
    question: requestedQuestion,
    captureRevision: requestedCaptureRevision,
  }).current
  const { register, handleSubmit, getValues, reset, setError, clearErrors, formState } =
    useForm<AnswerFields>({ defaultValues: emptyAnswer })
  const submission = useRef<AnswerSubmission | null>(null)
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
  const retrying = submission.current !== null
  const hasCurrentDraft = !stale && formState.isDirty
  const deliveryUnavailable = disabled || readOnly || formState.isSubmitting
  const submitDisabled = deliveryUnavailable || (!retrying && !hasCurrentDraft)
  // A session question reaches the running or resumable session; it never starts a continuation.
  let actionLabel = question.assumption
    ? 'Send answer to the session'
    : 'Save answer and queue continuation'
  if (formState.isSubmitting) {
    actionLabel = 'Saving answer…'
  } else if (retrying) {
    actionLabel = 'Retry exact answer'
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
    } catch {
      setError('root.command', {
        type: 'server',
        message:
          'Answer not confirmed. Your answer may already be saved. Retry sends only this original answer; discard clears only the local draft.',
      })
    }
  }

  return (
    <Card
      aria-label="Pinned application question"
      onChange={reportDirty}
      onSubmit={handleSubmit(submit)}
    >
      <h3>{question.spec.prompt}</h3>
      <Paragraph>{question.spec.reason}</Paragraph>
      <Small>
        Attempt {question.attempt_id.slice(0, 8)} · question revision {question.revision}
      </Small>
      {stale && (
        <Notice role="status">
          {retrying
            ? 'The saved question context changed. Retry only the original unconfirmed answer, or discard the local draft.'
            : 'This question is superseded or its saved context changed. Your unsaved answer is preserved; it cannot be applied to another question.'}
        </Notice>
      )}
      {question.assumption && (
        <Paragraph>The agent keeps working on this assumption: {question.assumption}</Paragraph>
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
          <Field>
            <Label htmlFor={`basis-${question.id}`}>How was the quantity determined?</Label>
            <Select id={`basis-${question.id}`} {...register('basis')}>
              <option value="counted">Counted</option>
              <option value="estimated">Estimated</option>
            </Select>
          </Field>
        )}
        {error && (
          <ErrorNotice id={errorId} role="alert">
            {error}
          </ErrorNotice>
        )}
      </Fieldset>
      <Actions>
        <Button disabled={submitDisabled} type="submit">
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
          ? 'This human answer updates the saved lot or note and reaches the agent session.'
          : 'This human answer updates the saved lot or note and queues a new attempt.'}
      </Small>
    </Card>
  )
}

const Card = styled.form`
  padding: 20px;
  border: 1px solid ${color.warn};
  border-radius: 8px;
  background: ${color.warnWeak};
  h3 {
    margin: 0 0 8px;
  }
`

const Actions = styled.div`
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin: 16px 0;
`

const Field = styled.div`
  display: grid;
  gap: 8px;
  margin-top: 14px;
`
