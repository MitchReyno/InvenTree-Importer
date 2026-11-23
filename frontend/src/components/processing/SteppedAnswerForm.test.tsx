import { fireEvent, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { expect, test, vi } from 'vitest'
import { IntakeRequestError } from '@invimport/contracts/client'
import { validate, type ProcessingQuestionV2Dto, type QuestionStepDto } from '@invimport/contracts'
import { render } from '#/test/render'
import { QuestionAnswer } from './QuestionAnswer'

const questionId = 'e0000000-0000-4000-8000-000000000002'
const base: Omit<ProcessingQuestionV2Dto, 'steps'> = {
  id: questionId,
  job_id: '30000000-0000-4000-8000-000000000003',
  attempt_id: '40000000-0000-4000-8000-000000000004',
  input_sha256: 'a'.repeat(64),
  revision: '1',
  state: 'open',
  subject_id: '20000000-0000-4000-8000-000000000002',
  schema_version: 'bench-intake-question/2',
  fields: ['identity', 'quantity'],
  reason: 'Same MPN on both labels, but the date codes differ.',
}

const samePart = {
  id: 'same_part',
  prompt: 'Are packets A and B the same Part?',
  assumption: 'Treating them as the same Part.',
  answer: {
    kind: 'choice',
    options: [
      { id: 'same', label: 'Yes, same Part', detail: 'RES-0144, two lots' },
      { id: 'different', label: 'No, different Parts' },
    ],
    other: true,
  },
} satisfies QuestionStepDto
const left = {
  id: 'left',
  prompt: 'How many are left in packet B?',
  assumption: 'An estimated 380.',
  answer: { kind: 'number' },
} satisfies QuestionStepDto
const place = {
  id: 'place',
  prompt: 'Where should packet B go?',
  assumption: 'Drawer R3, with packet A.',
  answer: {
    kind: 'choice',
    options: [
      { id: 'r3', label: 'Drawer R3' },
      { id: 'r4', label: 'Drawer R4' },
    ],
    other: false,
  },
} satisfies QuestionStepDto

const oneStep: ProcessingQuestionV2Dto = { ...base, steps: [samePart] }
const threeSteps: ProcessingQuestionV2Dto = {
  ...base,
  title: 'About the 10 kΩ packets',
  steps: [samePart, left, place],
}

type Answer = (questionId: string, input: unknown, key: string) => Promise<void>

function mount(question: ProcessingQuestionV2Dto, answer = vi.fn<Answer>(async () => {})) {
  const onDirtyChange = vi.fn()
  const props = {
    captureRevision: '4',
    currentCaptureRevision: '4',
    disabled: false,
    onDirtyChange,
    answer,
  }
  const view = render(<QuestionAnswer question={question} currentQuestion={question} {...props} />)

  const rerender = (current: ProcessingQuestionV2Dto | undefined, revision = '4') =>
    view.rerender(
      <QuestionAnswer
        question={question}
        {...props}
        currentQuestion={current}
        currentCaptureRevision={revision}
      />,
    )

  return { answer, onDirtyChange, rerender }
}

test('a one-step choice is picked, then sent with Send', async () => {
  const user = userEvent.setup()
  validate('ProcessingQuestion', oneStep)
  const { answer, onDirtyChange } = mount(oneStep)
  expect(
    screen.getByText(/keeps working on this assumption: Treating them as the same/),
  ).toBeVisible()
  const send = screen.getByRole('button', { name: 'Send answer' })
  expect(send).toBeDisabled()
  expect(screen.queryByText(/Step 1 of/)).not.toBeInTheDocument()

  // Picking an option chooses it and sends nothing.
  await user.click(screen.getByRole('radio', { name: /No, different Parts/ }))
  expect(answer).not.toHaveBeenCalled()
  expect(onDirtyChange).toHaveBeenLastCalledWith(true)
  await user.click(send)
  expect(answer).toHaveBeenCalledWith(
    questionId,
    expect.objectContaining({
      schema_version: 'bench-intake-answer/2',
      expected_capture_revision: '4',
      steps: [{ step_id: 'same_part', value: { kind: 'choice', option_id: 'different' } }],
    }),
    expect.any(String),
  )
  expect(onDirtyChange).toHaveBeenLastCalledWith(false)
})

test('"Something else" takes the operator’s own words', async () => {
  const user = userEvent.setup()
  const { answer } = mount(oneStep)
  await user.click(screen.getByRole('radio', { name: /Something else/ }))
  const send = screen.getByRole('button', { name: 'Send answer' })
  expect(send).toBeDisabled()
  await user.type(screen.getByLabelText('In your own words'), 'A clone with no MPN')
  await user.click(send)
  expect(answer).toHaveBeenCalledWith(
    questionId,
    expect.objectContaining({
      steps: [{ step_id: 'same_part', value: { kind: 'choice', other: 'A clone with no MPN' } }],
    }),
    expect.any(String),
  )
})

test('a question with steps goes Back and Next, then a summary with Change, then one send', async () => {
  const user = userEvent.setup()
  const { answer } = mount(threeSteps)
  expect(screen.getByText('About the 10 kΩ packets')).toBeVisible()
  expect(screen.getByText('Step 1 of 3')).toBeVisible()
  expect(screen.queryByText(/Your answer updates the saved lot or note/)).toBeNull()
  expect(screen.queryByRole('button', { name: 'Back' })).not.toBeInTheDocument()

  const next = () => screen.getByRole('button', { name: 'Next' })

  expect(next()).toBeDisabled()
  await user.click(screen.getByRole('radio', { name: /Yes, same Part/ }))
  await user.click(next())

  expect(screen.getByText('Step 2 of 3')).toBeVisible()
  expect(screen.getByText(/keeps working on this assumption: An estimated 380/)).toBeVisible()
  await user.type(screen.getByLabelText('Quantity'), '380')
  await user.click(screen.getByRole('button', { name: 'Estimated' }))
  await user.click(screen.getByRole('button', { name: 'Back' }))
  expect(screen.getByRole('radio', { name: /Yes, same Part/ })).toBeChecked()
  await user.click(next())
  // Every step's draft is kept while moving between them.
  expect(screen.getByLabelText('Quantity')).toHaveValue('380')
  await user.click(next())
  await user.click(screen.getByRole('radio', { name: /Drawer R3/ }))
  await user.click(next())

  expect(screen.getByText('Check your answers')).toBeVisible()
  const rows = within(screen.getByLabelText('Your answers'))
  expect(rows.getByText('Yes, same Part')).toBeVisible()
  expect(rows.getByText('380 · estimated')).toBeVisible()
  expect(rows.getByText('Drawer R3')).toBeVisible()
  // Each assumption stays in view until the answer is sent.
  expect(rows.getByText('Assuming until sent: An estimated 380.')).toBeVisible()
  // What sending does is said beside Send, not beside Next.
  expect(screen.getByText(/Your answer updates the saved lot or note/)).toBeVisible()
  await user.click(rows.getByRole('button', { name: 'Change: Where should packet B go?' }))
  expect(screen.getByText('Step 3 of 3')).toBeVisible()
  await user.click(screen.getByRole('radio', { name: /Drawer R4/ }))
  await user.click(next())
  expect(within(screen.getByLabelText('Your answers')).getByText('Drawer R4')).toBeVisible()

  await user.click(screen.getByRole('button', { name: 'Send 3 answers' }))
  expect(answer).toHaveBeenCalledTimes(1)
  expect(answer).toHaveBeenCalledWith(
    questionId,
    expect.objectContaining({
      steps: [
        { step_id: 'same_part', value: { kind: 'choice', option_id: 'same' } },
        { step_id: 'left', value: { kind: 'number', value: '380', basis: 'estimated' } },
        { step_id: 'place', value: { kind: 'choice', option_id: 'r4' } },
      ],
    }),
    expect.any(String),
  )
})

test('a number step shows a plain fix for prose and blocks Next, or takes an answer in words', async () => {
  const user = userEvent.setup()
  const { answer } = mount({ ...threeSteps, steps: [left, place] })
  const quantity = screen.getByLabelText('Quantity')
  await user.type(quantity, 'about 380')
  expect(screen.getByRole('alert')).toHaveTextContent(
    'Enter just the number, like 380. Choose “Estimated” if it isn’t an exact count.',
  )
  expect(quantity).toHaveAttribute('aria-invalid', 'true')
  expect(screen.getByRole('button', { name: 'Next' })).toBeDisabled()
  await user.clear(quantity)
  await user.type(quantity, '380')
  expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Next' })).toBeEnabled()

  await user.click(screen.getByRole('button', { name: /Answer in words/ }))
  expect(screen.getByRole('button', { name: 'Next' })).toBeDisabled()
  await user.type(screen.getByLabelText('Your answer in words'), 'Still sealed in the reel')
  await user.click(screen.getByRole('button', { name: 'Next' }))
  await user.click(screen.getByRole('radio', { name: /Drawer R4/ }))
  await user.click(screen.getByRole('button', { name: 'Next' }))
  expect(
    within(screen.getByLabelText('Your answers')).getByText('Still sealed in the reel'),
  ).toBeVisible()
  await user.click(screen.getByRole('button', { name: 'Send 2 answers' }))
  expect(answer).toHaveBeenCalledWith(
    questionId,
    expect.objectContaining({
      steps: [
        { step_id: 'left', value: { kind: 'text', text: 'Still sealed in the reel' } },
        { step_id: 'place', value: { kind: 'choice', option_id: 'r4' } },
      ],
    }),
    expect.any(String),
  )
})

test('a draft keeps every step when its question is superseded, and cannot be sent', async () => {
  const user = userEvent.setup()
  const { rerender, onDirtyChange } = mount(threeSteps)
  await user.click(screen.getByRole('radio', { name: /No, different Parts/ }))
  await user.click(screen.getByRole('button', { name: 'Next' }))
  await user.type(screen.getByLabelText('Quantity'), '12')

  rerender({ ...threeSteps, state: 'superseded' })
  expect(screen.getByRole('status')).toHaveTextContent(
    'This question is superseded or its saved context changed',
  )
  expect(screen.getByLabelText('Quantity')).toHaveValue('12')
  await user.click(screen.getByRole('button', { name: 'Back' }))
  expect(screen.getByRole('radio', { name: /No, different Parts/ })).toBeChecked()
  expect(onDirtyChange).toHaveBeenLastCalledWith(true)
  await user.click(screen.getByRole('button', { name: 'Next' }))
  await user.click(screen.getByRole('button', { name: 'Next' }))
  await user.click(screen.getByRole('radio', { name: /Drawer R3/ }))
  await user.click(screen.getByRole('button', { name: 'Next' }))
  expect(screen.getByRole('button', { name: 'Send 3 answers' })).toBeDisabled()
})

test('a refusal naming a step keeps the draft editable and marks that step', async () => {
  const user = userEvent.setup()
  const answer = vi
    .fn<Answer>()
    .mockRejectedValueOnce(new IntakeRequestError(422, 'invalid_answer', 'left'))
    .mockResolvedValueOnce(undefined)
  mount(threeSteps, answer)
  await user.click(screen.getByRole('radio', { name: /Yes, same Part/ }))
  await user.click(screen.getByRole('button', { name: 'Next' }))
  await user.type(screen.getByLabelText('Quantity'), '380')
  await user.click(screen.getByRole('button', { name: 'Next' }))
  await user.click(screen.getByRole('radio', { name: /Drawer R4/ }))
  await user.click(screen.getByRole('button', { name: 'Next' }))
  await user.click(screen.getByRole('button', { name: 'Send 3 answers' }))

  // Back on the named step, editable, with why.
  expect(await screen.findByText('Step 2 of 3')).toBeVisible()
  expect(screen.getByRole('alert')).toHaveTextContent('This answer wasn’t accepted')
  const quantity = screen.getByLabelText('Quantity')
  expect(quantity).toBeEnabled()
  await user.clear(quantity)
  await user.type(quantity, '381')
  await user.click(screen.getByRole('button', { name: 'Next' }))
  await user.click(screen.getByRole('button', { name: 'Next' }))
  await user.click(screen.getByRole('button', { name: 'Send 3 answers' }))
  const [first, second] = answer.mock.calls
  // A fixed draft is a new answer with its own key.
  expect(second[2]).not.toBe(first[2])
  expect(second[1]).toEqual(
    expect.objectContaining({
      steps: expect.arrayContaining([
        { step_id: 'left', value: { kind: 'number', value: '381', basis: 'counted' } },
      ]),
    }),
  )
})

test('an uncertain failure retries only the original answer and key', async () => {
  const user = userEvent.setup()
  const answer = vi
    .fn<Answer>()
    .mockRejectedValueOnce(new Error('processing_command_not_confirmed'))
    .mockResolvedValueOnce(undefined)
  mount(oneStep, answer)
  await user.click(screen.getByRole('radio', { name: /Yes, same Part/ }))
  await user.click(screen.getByRole('button', { name: 'Send answer' }))
  expect(await screen.findByRole('alert')).toHaveTextContent('Answer not confirmed')
  // The draft is locked to what was sent.
  expect(screen.getByRole('radio', { name: /No, different Parts/ })).toBeDisabled()
  await user.click(screen.getByRole('button', { name: 'Retry exact answer' }))
  const [first, second] = answer.mock.calls
  expect(second).toEqual(first)
})

test('text limits count characters as the contract does, so 2048 emoji fit and one more doesn\u2019t', () => {
  mount({
    ...base,
    steps: [
      { id: 'note', prompt: 'Anything else?', assumption: 'Nothing.', answer: { kind: 'text' } },
    ],
  })
  const box = screen.getByLabelText('Your answer')
  const send = screen.getByRole('button', { name: 'Send answer' })
  fireEvent.change(box, { target: { value: '\u{1F600}'.repeat(2048) } })
  expect(box).toHaveValue('\u{1F600}'.repeat(2048))
  expect(send).toBeEnabled()
  expect(screen.queryByRole('alert')).toBeNull()
  fireEvent.change(box, { target: { value: '\u{1F600}'.repeat(2049) } })
  expect(screen.getByRole('alert')).toHaveTextContent('Keep it to 2048 characters.')
  expect(send).toBeDisabled()
})
