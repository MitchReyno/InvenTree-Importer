import { screen, within } from '@testing-library/react'
import { expect, test, vi } from 'vitest'
import type { ProcessingQuestionDto } from '@invimport/contracts'
import { render } from '#/test/render'
import { QuestionAnswer } from './QuestionAnswer'

const question: ProcessingQuestionDto = {
  id: 'q1',
  job_id: 'job',
  attempt_id: 'attempt',
  input_sha256: 'a'.repeat(64),
  revision: '1',
  state: 'open',
  spec: {
    kind: 'quantity',
    subject_id: 'lot',
    prompt: 'How many reels?',
    reason: 'The count is folded.',
  },
}
const props = {
  captureRevision: '4',
  currentCaptureRevision: '4',
  disabled: false,
  onDirtyChange: vi.fn(),
  answer: vi.fn(),
}

test('a session question shows the assumption in use and sends the answer to the session', () => {
  const session = {
    ...question,
    fields: ['quantity' as const],
    assumption: 'Treating it as one reel.',
  }
  render(<QuestionAnswer question={session} currentQuestion={session} {...props} />)
  expect(
    screen.getByText(/keeps working on this assumption: Treating it as one reel/),
  ).toBeVisible()
  expect(screen.getByRole('button', { name: 'Send answer to the session' })).toBeInTheDocument()
})

test('an earlier-profile question still queues a continuation', () => {
  render(<QuestionAnswer question={question} currentQuestion={question} {...props} />)
  expect(screen.queryByText(/keeps working on this assumption/)).not.toBeInTheDocument()
  expect(
    screen.getByRole('button', { name: 'Save answer and queue continuation' }),
  ).toBeInTheDocument()
})

test('answers inside the question card, choosing the basis from options', () => {
  render(
    <QuestionAnswer
      question={question}
      currentQuestion={question}
      captureHref="#b/capture"
      {...props}
    />,
  )
  expect(screen.getByRole('group', { name: 'How many reels?' })).toBeVisible()
  const basis = screen.getByRole('radiogroup', { name: 'How was the quantity determined?' })
  expect(within(basis).getByRole('radio', { name: /^Counted/ })).toBeChecked()
  expect(within(basis).getByRole('radio', { name: /^Estimated/ })).not.toBeChecked()
  expect(screen.getByRole('link', { name: 'Add a photo' })).toHaveAttribute('href', '#b/capture')
})
