import { useEffect, useRef, type FormEvent } from 'react'
import { useForm } from 'react-hook-form'
import styled from 'styled-components'
import {
  validate,
  type ProcessingAnswerDto,
  type ProcessingQuestionDto,
} from '@invimport/contracts'
import {
  Button,
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

interface Props {
  question: ProcessingQuestionDto
  captureRevision: string
  currentQuestion: ProcessingQuestionDto | undefined
  currentCaptureRevision: string
  disabled: boolean
  onDirtyChange: (dirty: boolean) => void
  answer: (questionId: string, input: ProcessingAnswerDto, key: string) => Promise<void>
}

interface AnswerFields {
  value: string
  basis: 'counted' | 'estimated'
}

const emptyAnswer: AnswerFields = { value: '', basis: 'counted' }

/** Mount identity is pinned. Polling changes current validity, never the editing target or fields. */
export function QuestionAnswer({
  question: requestedQuestion,
  captureRevision: requestedCaptureRevision,
  currentQuestion,
  currentCaptureRevision,
  disabled,
  onDirtyChange,
  answer,
}: Props) {
  const { question, captureRevision } = useRef({
    question: requestedQuestion,
    captureRevision: requestedCaptureRevision,
  }).current
  const { register, handleSubmit, getValues, reset, setError, clearErrors, formState } =
    useForm<AnswerFields>({ defaultValues: emptyAnswer })
  const submission = useRef<{ fingerprint: string; key: string } | null>(null)
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
    const values = getValues()
    // Use the event value explicitly: navigation must see this edit before a later RHF render.
    const nextValue = target.name === 'value' ? target.value : values.value
    const nextBasis = target.name === 'basis' ? target.value : values.basis
    onDirtyChange(nextValue !== emptyAnswer.value || nextBasis !== emptyAnswer.basis)
  }

  function discard() {
    reset(emptyAnswer)
    submission.current = null
    onDirtyChange(false)
  }

  async function submit(values: AnswerFields) {
    if (stale || disabled) {
      return
    }
    clearErrors()
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
    try {
      validate('ProcessingAnswer', input)
    } catch {
      const message =
        question.spec.kind === 'quantity'
          ? 'Enter a positive exact quantity with at most six decimal places.'
          : 'Enter a clarification of up to 2048 characters.'
      setError('value', { type: 'contract', message })
      return
    }

    const fingerprint = JSON.stringify(input)
    if (submission.current?.fingerprint !== fingerprint) {
      submission.current = { fingerprint, key: crypto.randomUUID() }
    }
    try {
      await answer(question.id, input, submission.current.key)
      reset(emptyAnswer)
      submission.current = null
      onDirtyChange(false)
    } catch {
      setError('root.command', {
        type: 'server',
        message:
          'Answer not confirmed. Your input and original question are kept. Refresh status before retrying this same answer.',
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
          This question is superseded or its saved context changed. Your unsaved answer is
          preserved; it cannot be applied to another question.
        </Notice>
      )}
      <Fieldset disabled={formState.isSubmitting}>
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
        <Actions>
          <Button
            disabled={stale || disabled || formState.isSubmitting || !formState.isDirty}
            type="submit"
          >
            {formState.isSubmitting ? 'Saving answer…' : 'Save answer and queue continuation'}
          </Button>
          {formState.isDirty && (
            <Button type="button" disabled={formState.isSubmitting} onClick={discard}>
              Discard unsaved answer
            </Button>
          )}
        </Actions>
      </Fieldset>
      <Small>This human answer updates the saved lot or note and queues a new attempt.</Small>
    </Card>
  )
}

const Card = styled.form`
  padding: 20px;
  border: 1px solid #d5ba79;
  border-radius: 8px;
  background: #fffaf0;
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
