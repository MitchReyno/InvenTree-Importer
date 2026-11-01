import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { expect, test, vi } from 'vitest'
import type { ProcessingSnapshotDto } from '@invimport/contracts'
import { QuestionAnswer } from './components/processing/QuestionAnswer'

type Question = ProcessingSnapshotDto['jobs'][number]['questions'][number]
const question: Question = {
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
  await user.click(screen.getByRole('button', { name: 'Save answer and queue continuation' }))
  await waitFor(() => expect(answer).toHaveBeenCalledTimes(2))

  expect(answer.mock.calls[1]).toEqual(answer.mock.calls[0])
  expect(answer.mock.calls[0][1]).toMatchObject({
    attempt_id: question.attempt_id,
    input_sha256: question.input_sha256,
    value: { kind: 'quantity', value: '17.000001', basis: 'counted' },
  })
  expect(screen.getByLabelText('Quantity')).toHaveValue('17.000001')
})
