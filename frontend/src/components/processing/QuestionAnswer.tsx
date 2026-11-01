import { useEffect, useRef, useState, type FormEvent } from 'react'
import styled from 'styled-components'
import {
  validate,
  type ProcessingAnswerDto,
  type ProcessingQuestionDto,
} from '@invimport/contracts'
import {
  Button,
  ErrorNotice,
  Input,
  Label,
  Notice,
  Paragraph,
  Select,
  Small,
  TextArea,
} from '../ui/primitives'

type Question = ProcessingQuestionDto

interface Props {
  question: Question
  captureRevision: string
  currentQuestion: Question | undefined
  currentCaptureRevision: string
  disabled: boolean
  onDirtyChange: (dirty: boolean) => void
  answer: (questionId: string, input: ProcessingAnswerDto, key: string) => Promise<void>
}

/** Mount identity is pinned by the parent. Polling changes current validity, never the editing target. */
export function QuestionAnswer({
  question,
  captureRevision,
  currentQuestion,
  currentCaptureRevision,
  disabled,
  onDirtyChange,
  answer,
}: Props) {
  const [value, setValue] = useState('')
  const [basis, setBasis] = useState<'counted' | 'estimated'>('counted')
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  const submission = useRef<{ fingerprint: string; key: string } | null>(null)
  const dirty = value.length > 0
  const stale =
    !currentQuestion ||
    currentQuestion.id !== question.id ||
    currentQuestion.state !== 'open' ||
    currentQuestion.revision !== question.revision ||
    currentQuestion.attempt_id !== question.attempt_id ||
    currentQuestion.input_sha256 !== question.input_sha256 ||
    currentCaptureRevision !== captureRevision
  const dirtyObserver = useRef(onDirtyChange)
  dirtyObserver.current = onDirtyChange
  useEffect(() => () => dirtyObserver.current(false), [])
  function change(next: string) {
    setValue(next)
    onDirtyChange(next.length > 0)
  }
  async function submit() {
    if (stale || disabled || saving) {
      return
    }
    const typed: ProcessingAnswerDto['value'] =
      question.spec.kind === 'quantity'
        ? { kind: 'quantity', value, basis }
        : { kind: 'clarification', text: value }
    const input: ProcessingAnswerDto = {
      schema_version: 'bench-intake-answer/1',
      expected_question_revision: question.revision,
      expected_capture_revision: captureRevision,
      attempt_id: question.attempt_id,
      input_sha256: question.input_sha256,
      value: typed,
    }
    try {
      validate('ProcessingAnswer', input)
    } catch {
      setError(
        question.spec.kind === 'quantity'
          ? 'Enter a positive exact quantity with at most six decimal places.'
          : 'Enter a clarification of up to 2048 characters.',
      )
      return
    }

    const fingerprint = JSON.stringify(input)
    if (submission.current?.fingerprint !== fingerprint) {
      submission.current = { fingerprint, key: crypto.randomUUID() }
    }
    setSaving(true)
    setError('')
    try {
      await answer(question.id, input, submission.current.key)
      setValue('')
      onDirtyChange(false)
    } catch {
      setError(
        'Answer not confirmed. Your input and original question are kept. Refresh status before retrying this same answer.',
      )
    } finally {
      setSaving(false)
    }
  }
  function handleSubmit(event: FormEvent) {
    event.preventDefault()
    void submit()
  }

  return (
    <Card aria-label="Pinned application question" onSubmit={handleSubmit}>
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
      <Field>
        <Label htmlFor={`answer-${question.id}`}>
          {question.spec.kind === 'quantity' ? 'Quantity' : 'Clarification'}
        </Label>
        {question.spec.kind === 'quantity' ? (
          <Input
            id={`answer-${question.id}`}
            value={value}
            inputMode="decimal"
            onChange={(event) => change(event.target.value)}
          />
        ) : (
          <TextArea
            id={`answer-${question.id}`}
            value={value}
            maxLength={2048}
            onChange={(event) => change(event.target.value)}
          />
        )}
      </Field>
      {question.spec.kind === 'quantity' && (
        <Field>
          <Label htmlFor={`basis-${question.id}`}>How was the quantity determined?</Label>
          <Select
            id={`basis-${question.id}`}
            value={basis}
            onChange={(event) => setBasis(event.target.value as typeof basis)}
          >
            <option value="counted">Counted</option>
            <option value="estimated">Estimated</option>
          </Select>
        </Field>
      )}
      {error && <ErrorNotice role="alert">{error}</ErrorNotice>}
      <Actions>
        <Button disabled={stale || disabled || saving || !dirty} type="submit">
          {saving ? 'Saving answer…' : 'Save answer and queue continuation'}
        </Button>
        {dirty && (
          <Button type="button" disabled={saving} onClick={() => change('')}>
            Discard unsaved answer
          </Button>
        )}
      </Actions>
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
