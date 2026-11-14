import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { expect, test, vi } from 'vitest'
import type { ProcessingQuestionDto } from '@invimport/contracts'
import { QuestionAnswer } from './components/processing/QuestionAnswer'

const question: ProcessingQuestionDto = {
  id: '10000000-0000-4000-8000-000000000001',
  job_id: '20000000-0000-4000-8000-000000000002',
  attempt_id: '30000000-0000-4000-8000-000000000003',
  input_sha256: 'a'.repeat(64),
  revision: '2',
  state: 'open',
  spec: {
    kind: 'quantity',
    subject_id: '40000000-0000-4000-8000-000000000004',
    prompt: 'How many are in Packet A?',
    reason: 'The count is unclear.',
  },
}

test('a polled replacement cannot redirect a dirty pinned answer', async () => {
  const user = userEvent.setup()
  const answer = vi.fn().mockResolvedValue(undefined)
  const dirty = vi.fn()
  const props = {
    question,
    captureRevision: '8',
    currentQuestion: question,
    currentCaptureRevision: '8',
    disabled: false,
    onDirtyChange: dirty,
    answer,
  }
  const view = render(<QuestionAnswer {...props} />)
  await user.type(screen.getByLabelText('Quantity'), '37')
  expect(dirty).toHaveBeenLastCalledWith(true)

  view.rerender(
    <QuestionAnswer
      {...props}
      currentQuestion={{
        ...question,
        id: '50000000-0000-4000-8000-000000000005',
        attempt_id: '60000000-0000-4000-8000-000000000006',
        state: 'superseded',
      }}
      currentCaptureRevision="9"
    />,
  )
  expect(screen.getByLabelText('Quantity')).toHaveValue('37')
  expect(screen.getByRole('button', { name: 'Save answer and queue continuation' })).toBeDisabled()
  expect(answer).not.toHaveBeenCalled()
  expect(screen.getByText(/unsaved answer is preserved/)).toBeInTheDocument()
  await act(async () => {
    fireEvent.submit(screen.getByRole('form', { name: 'Pinned application question' }))
  })
  expect(answer).not.toHaveBeenCalled()
})

test('lost acknowledgement preserves typed value and exact idempotency key for retry', async () => {
  const user = userEvent.setup()
  const answer = vi.fn().mockRejectedValue(new Error('connection_lost'))
  render(
    <QuestionAnswer
      question={question}
      captureRevision="8"
      currentQuestion={question}
      currentCaptureRevision="8"
      disabled={false}
      onDirtyChange={() => {}}
      answer={answer}
    />,
  )
  await user.type(screen.getByLabelText('Quantity'), '17.000001')
  await user.click(screen.getByRole('button', { name: 'Save answer and queue continuation' }))
  await waitFor(() => expect(answer).toHaveBeenCalledTimes(1))
  await user.click(screen.getByRole('button', { name: 'Retry exact answer' }))
  await waitFor(() => expect(answer).toHaveBeenCalledTimes(2))

  expect(answer.mock.calls[1]).toEqual(answer.mock.calls[0])
  expect(answer.mock.calls[0][1]).toMatchObject({
    attempt_id: question.attempt_id,
    input_sha256: question.input_sha256,
    value: { kind: 'quantity', value: '17.000001', basis: 'counted' },
  })
  expect(screen.getByLabelText('Quantity')).toHaveValue('17.000001')
})

test('RHF reports dirty input synchronously and keeps TypeBox quantity errors without sending', async () => {
  const user = userEvent.setup()
  const answer = vi.fn().mockResolvedValue(undefined)
  const dirty = vi.fn()
  render(
    <QuestionAnswer
      question={question}
      captureRevision="8"
      currentQuestion={question}
      currentCaptureRevision="8"
      disabled={false}
      onDirtyChange={dirty}
      answer={answer}
    />,
  )
  fireEvent.change(screen.getByLabelText('Quantity'), { target: { value: '1e2' } })
  expect(dirty).toHaveBeenLastCalledWith(true)
  await user.click(screen.getByRole('button', { name: 'Save answer and queue continuation' }))
  expect(await screen.findByRole('alert')).toHaveTextContent('positive exact quantity')
  expect(screen.getByLabelText('Quantity')).toHaveValue('1e2')
  expect(answer).not.toHaveBeenCalled()

  await user.click(screen.getByRole('button', { name: 'Discard unsaved answer' }))
  expect(screen.getByLabelText('Quantity')).toHaveValue('')
  expect(dirty).toHaveBeenLastCalledWith(false)
})

test('a replacement question prop cannot adopt the mounted form draft, even with equal revisions', async () => {
  const user = userEvent.setup()
  const answer = vi.fn().mockResolvedValue(undefined)
  const props = {
    question,
    captureRevision: '8',
    currentQuestion: question,
    currentCaptureRevision: '8',
    disabled: false,
    onDirtyChange: vi.fn(),
    answer,
  }
  const view = render(<QuestionAnswer {...props} />)
  await user.type(screen.getByLabelText('Quantity'), '9007199254740.123456')
  const replacement = {
    ...question,
    id: '70000000-0000-4000-8000-000000000007',
    spec: { ...question.spec, prompt: 'Replacement question' },
  }
  view.rerender(<QuestionAnswer {...props} question={replacement} currentQuestion={replacement} />)
  expect(screen.queryByText('Replacement question')).not.toBeInTheDocument()
  expect(screen.getByLabelText('Quantity')).toHaveValue('9007199254740.123456')
  expect(screen.getByRole('button', { name: 'Save answer and queue continuation' })).toBeDisabled()
  expect(answer).not.toHaveBeenCalled()
})

test('pending submission freezes fields and confirmed save clears the guard without coercing exact strings', async () => {
  const user = userEvent.setup()

  let finish: () => void = () => {}

  const pending = new Promise<void>((resolve) => {
    finish = resolve
  })
  const answer = vi.fn().mockReturnValue(pending)
  const dirty = vi.fn()
  render(
    <QuestionAnswer
      question={question}
      captureRevision="8"
      currentQuestion={question}
      currentCaptureRevision="8"
      disabled={false}
      onDirtyChange={dirty}
      answer={answer}
    />,
  )
  await user.type(screen.getByLabelText('Quantity'), '9007199254740.123456')
  await user.click(screen.getByRole('radio', { name: /^Estimated/ }))
  await user.click(screen.getByRole('button', { name: 'Save answer and queue continuation' }))
  await waitFor(() => expect(screen.getByLabelText('Quantity')).toBeDisabled())
  await user.type(screen.getByLabelText('Quantity'), '99')
  expect(screen.getByLabelText('Quantity')).toHaveValue('9007199254740.123456')
  expect(answer.mock.calls[0][1].value).toEqual({
    kind: 'quantity',
    value: '9007199254740.123456',
    basis: 'estimated',
  })
  finish()
  await waitFor(() => expect(screen.getByLabelText('Quantity')).toHaveValue(''))
  expect(dirty).toHaveBeenLastCalledWith(false)
})

test.each(['answered', 'missing', 'replaced'] as const)(
  'an unconfirmed answer retries its original receipt after polling reports the question %s',
  async (polledState) => {
    const user = userEvent.setup()
    const answer = vi.fn().mockRejectedValueOnce(new Error('lost_ack')).mockResolvedValue(undefined)
    const dirty = vi.fn()
    const props = {
      question,
      captureRevision: '8',
      currentQuestion: question,
      currentCaptureRevision: '8',
      disabled: false,
      onDirtyChange: dirty,
      answer,
    }
    const view = render(<QuestionAnswer {...props} />)
    await user.type(screen.getByLabelText('Quantity'), '17.000001')
    await user.click(screen.getByRole('radio', { name: /^Estimated/ }))
    await user.click(screen.getByRole('button', { name: 'Save answer and queue continuation' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Answer not confirmed')
    const original = structuredClone(answer.mock.calls[0])

    let currentQuestion: ProcessingQuestionDto | undefined
    if (polledState === 'answered') {
      currentQuestion = { ...question, state: 'answered', revision: '3' }
    } else if (polledState === 'replaced') {
      currentQuestion = {
        ...question,
        id: '50000000-0000-4000-8000-000000000005',
        attempt_id: '60000000-0000-4000-8000-000000000006',
      }
    }
    view.rerender(
      <QuestionAnswer {...props} currentQuestion={currentQuestion} currentCaptureRevision="9" />,
    )
    const retry = screen.getByRole('button', {
      name: 'Retry exact answer',
    })
    expect(retry).toBeEnabled()
    expect(screen.getByLabelText('Quantity')).toBeDisabled()
    expect(screen.getByRole('radio', { name: /^Estimated/ })).toBeDisabled()
    expect(screen.getByLabelText('Quantity')).toHaveValue('17.000001')
    await user.click(retry)
    await waitFor(() => expect(answer).toHaveBeenCalledTimes(2))
    expect(answer.mock.calls[1]).toEqual(original)
    expect(answer.mock.calls[1][0]).toBe(question.id)
    expect(answer.mock.calls[1][1].expected_capture_revision).toBe('8')
    await waitFor(() => expect(screen.getByLabelText('Quantity')).toHaveValue(''))
    expect(dirty).toHaveBeenLastCalledWith(false)
  },
)

test('unconfirmed fields stay frozen and a forced field change cannot replace the original delivery', async () => {
  const user = userEvent.setup()
  const answer = vi.fn().mockRejectedValueOnce(new Error('lost_ack')).mockResolvedValue(undefined)
  render(
    <QuestionAnswer
      question={question}
      captureRevision="8"
      currentQuestion={question}
      currentCaptureRevision="8"
      disabled={false}
      onDirtyChange={vi.fn()}
      answer={answer}
    />,
  )
  const quantity = screen.getByLabelText('Quantity')
  await user.type(quantity, '17.000001')
  await user.click(screen.getByRole('button', { name: 'Save answer and queue continuation' }))
  await screen.findByRole('alert')
  const original = structuredClone(answer.mock.calls[0])
  expect(quantity).toBeDisabled()
  await user.type(quantity, '99')
  expect(quantity).toHaveValue('17.000001')

  // The retained delivery must also survive programmatic values outside native disabled controls.
  fireEvent.change(quantity, { target: { value: '99' } })
  fireEvent.click(screen.getByRole('radio', { name: /^Estimated/ }))
  await user.click(screen.getByRole('button', { name: 'Retry exact answer' }))
  await waitFor(() => expect(answer).toHaveBeenCalledTimes(2))
  expect(answer.mock.calls[1]).toEqual(original)
})

test('exact retry retains unavailable-read and archive gates without losing its intent', async () => {
  const user = userEvent.setup()
  const answer = vi.fn().mockRejectedValueOnce(new Error('lost_ack')).mockResolvedValue(undefined)
  const props = {
    question,
    captureRevision: '8',
    currentQuestion: question,
    currentCaptureRevision: '8',
    disabled: false,
    onDirtyChange: vi.fn(),
    answer,
  }
  const view = render(<QuestionAnswer {...props} />)
  await user.type(screen.getByLabelText('Quantity'), '17')
  await user.click(screen.getByRole('button', { name: 'Save answer and queue continuation' }))
  await screen.findByRole('alert')
  const original = structuredClone(answer.mock.calls[0])

  for (const guard of [
    { disabled: true, readOnly: false },
    { disabled: false, readOnly: true },
  ]) {
    view.rerender(
      <QuestionAnswer
        {...props}
        {...guard}
        currentQuestion={undefined}
        currentCaptureRevision="9"
      />,
    )
    expect(screen.getByRole('button', { name: 'Retry exact answer' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Discard unsaved answer' })).toBeEnabled()
    await act(async () => {
      fireEvent.submit(screen.getByRole('form', { name: 'Pinned application question' }))
    })
    expect(answer).toHaveBeenCalledTimes(1)
  }

  view.rerender(
    <QuestionAnswer {...props} currentQuestion={undefined} currentCaptureRevision="9" />,
  )
  await user.click(screen.getByRole('button', { name: 'Retry exact answer' }))
  await waitFor(() => expect(answer).toHaveBeenCalledTimes(2))
  expect(answer.mock.calls[1]).toEqual(original)
})

test('explicit discard releases an unconfirmed delivery and permits a new validated intent', async () => {
  const user = userEvent.setup()
  const answer = vi.fn().mockRejectedValueOnce(new Error('lost_ack')).mockResolvedValue(undefined)
  const dirty = vi.fn()
  render(
    <QuestionAnswer
      question={question}
      captureRevision="8"
      currentQuestion={question}
      currentCaptureRevision="8"
      disabled={false}
      onDirtyChange={dirty}
      answer={answer}
    />,
  )
  await user.type(screen.getByLabelText('Quantity'), '17')
  await user.click(screen.getByRole('button', { name: 'Save answer and queue continuation' }))
  await screen.findByRole('alert')
  const original = structuredClone(answer.mock.calls[0])
  await user.click(screen.getByRole('button', { name: 'Discard unsaved answer' }))
  expect(screen.getByLabelText('Quantity')).toBeEnabled()
  expect(screen.getByLabelText('Quantity')).toHaveValue('')
  expect(dirty).toHaveBeenLastCalledWith(false)
  await user.type(screen.getByLabelText('Quantity'), '23')
  await user.click(screen.getByRole('button', { name: 'Save answer and queue continuation' }))
  await waitFor(() => expect(answer).toHaveBeenCalledTimes(2))
  expect(answer.mock.calls[1][2]).not.toBe(original[2])
  expect(answer.mock.calls[1][1].value).toEqual({ kind: 'quantity', value: '23', basis: 'counted' })
})
