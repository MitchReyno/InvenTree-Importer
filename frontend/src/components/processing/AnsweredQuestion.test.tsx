import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { expect, test } from 'vitest'
import type { ProcessingQuestionDto } from '@invimport/contracts'
import { render } from '#/test/render'
import {
  answered,
  choiceQuestion,
  fullAnswer,
  quantityQuestion,
  Q,
} from '#/test/answered-questions'
import { answeredLine, newestAnsweredFirst } from '#/processing/answered-line'
import { F, figuresQuestion, wornSuffixFigures } from '#/test/question-figures'
import { AnsweredQuestions } from './AnsweredQuestions'
import { ClosedQuestion } from './ClosedQuestion'

const sessionHref = '#batch/processing/examine/sessions/job'
const lot = { label: 'Lot 4', href: '#batch/review/lots/lot' }

function show(questions: ProcessingQuestionDto[], withLot = true) {
  const items = questions.map((question) => ({
    batchId: F.batch,
    question,
    line: answeredLine({ question, sessionState: 'running', stage: 'Examine' }),
    stage: 'Examine',
    sessionHref,
    ...(withLot ? { lot } : {}),
  }))
  render(<AnsweredQuestions items={newestAnsweredFirst(items)} lotLabel={() => 'Lot 4'} />)
  return screen.getByRole('region', { name: 'Answered' })
}

test('a /1 number answer expands to its question, struck assumption, answer, change and trail', async () => {
  const group = show([
    answered(
      quantityQuestion(),
      fullAnswer('186 · counted', {
        values: [{ step_id: null, prompt: 'How many?', text: '186 · counted', truncated: false }],
        effects: [{ kind: 'quantity', lot_id: Q.lot, value: '186', basis: 'counted' }],
        delivery: { state: 'read', read_at: '2026-11-24T02:09:00.000Z' },
      }),
    ),
  ])
  await userEvent.click(group.querySelector('summary')!)
  expect(group).toHaveTextContent('You answered 186 · counted · Examine read it')
  expect(group.querySelector('s')).toHaveTextContent('200 (estimate)')
  expect(group).toHaveTextContent('Lot 4’s quantity is now 186 (counted)')
  const trail = within(group).getByRole('list', { name: 'Delivery' })
  expect(trail).toHaveTextContent('You sent it')
  expect(trail).toHaveTextContent('Examine read it')
  expect(within(group).getByRole('link', { name: 'See it in the session' })).toHaveAttribute(
    'href',
    sessionHref,
  )
  expect(within(group).getByRole('link', { name: 'Lot 4' })).toBeInTheDocument()
})

test('a /2 answer expands to each step’s answer with a note as its change', async () => {
  const group = show([
    answered(
      choiceQuestion(),
      fullAnswer('Contents verified', {
        values: [
          {
            step_id: 'labels',
            prompt: 'Are labels reliable?',
            text: 'Contents verified',
            truncated: false,
          },
        ],
      }),
    ),
  ])
  expect(group).toHaveTextContent('You chose Contents verified · waiting for Examine to read it')
  expect(group.querySelector('s')).toHaveTextContent('Treat labels as provisional identification.')
  expect(group).toHaveTextContent('A note was added')
  expect(within(group).getByRole('list', { name: 'Delivery' })).toHaveTextContent(
    'Examine hasn’t read it yet',
  )
})

test('an earlier runner’s answer shows its summary with no read state and only the lot link', () => {
  const runner = { session_history: false }
  const full = show([
    answered(choiceQuestion(5, runner), fullAnswer('Contents verified', { delivery: undefined })),
  ])
  expect(full).toHaveTextContent('You chose Contents verified')
  expect(full).not.toHaveTextContent('read it')
  expect(within(full).queryByRole('link', { name: 'See it in the session' })).toBeNull()
  expect(within(full).getByRole('link', { name: 'Lot 4' })).toBeInTheDocument()
})

test('the compact and state-only tiers fall back, and the state-only lines come last', () => {
  const group = show([
    answered(choiceQuestion(1, { session_history: false })),
    answered(choiceQuestion(2), {
      answered_at: '2026-11-24T02:12:00.000Z',
      values_omitted: true,
      delivery: { state: 'waiting', read_at: null },
    }),
    // A reused job a later session attempt ran: it links the session, with no read state.
    answered(choiceQuestion(3), { answered_at: '2026-11-24T02:10:00.000Z', values_omitted: true }),
  ])
  const lines = [...group.querySelectorAll('details')]
  expect(lines[0]).toHaveTextContent('Answered · see the session · waiting for Examine to read it')
  expect(lines[1]).toHaveTextContent('Answered · see the session')
  expect(lines[1]).not.toHaveTextContent('read it')
  expect(lines[2]).toHaveTextContent('Answered · details not shown')
  expect(within(lines[2]).queryByRole('link', { name: 'See it in the session' })).toBeNull()
})

test('a replaced question links its replacement; one otherwise closed links its session', () => {
  render(
    <>
      <ClosedQuestion
        question={{ ...choiceQuestion(5), state: 'superseded', replaced_by: Q.question(9) }}
        replacementHref="#batch/processing/examine/q9"
      />
      <ClosedQuestion
        question={{ ...choiceQuestion(6), state: 'superseded' }}
        sessionHref={sessionHref}
      />
    </>,
  )
  const [replaced, closed] = screen.getAllByRole('status')
  expect(replaced).toHaveTextContent('Replaced by a newer question')
  expect(within(replaced).getByRole('link', { name: 'Open the newer question' })).toHaveAttribute(
    'href',
    '#batch/processing/examine/q9',
  )
  expect(closed).toHaveTextContent('No longer asked')
  expect(within(closed).getAllByRole('link')).toHaveLength(1)
  expect(within(closed).getByRole('link', { name: 'See it in the session' })).toHaveAttribute(
    'href',
    sessionHref,
  )
})

test('a titled multi-step answer with its values omitted still shows each step’s prompt', async () => {
  const stepped = choiceQuestion(5, {
    title: 'About the 10 kΩ packets',
    steps: [
      choiceQuestion().steps[0],
      {
        id: 'left',
        prompt: 'How many are left in packet B?',
        assumption: 'An estimated 380.',
        answer: { kind: 'number' },
      },
    ],
  })
  const group = show([
    answered(stepped, { answered_at: '2026-11-24T02:12:00.000Z', values_omitted: true }),
  ])
  await userEvent.click(group.querySelector('summary')!)
  expect(group).toHaveTextContent(
    'Are package labels reliable descriptions of their current contents?',
  )
  expect(group).toHaveTextContent('How many are left in packet B?')
  expect([...group.querySelectorAll('s')].map((struck) => struck.textContent)).toEqual([
    'Treat labels as provisional identification.',
    'An estimated 380.',
  ])
  expect(group).toHaveTextContent('Shown in the session.')
})

test('an expanded Answered line keeps the question’s pictures, which open the larger view', async () => {
  const group = show([answered(figuresQuestion(wornSuffixFigures()), fullAnswer('ATmega328P-AU'))])
  expect(within(group).queryByRole('button', { name: /^Open picture/ })).not.toBeVisible()

  await userEvent.click(group.querySelector('summary')!)
  const open = within(group).getByRole('button', { name: /^Open picture 1 of 4/ })
  expect(open).toBeVisible()
  expect(within(group).getByRole('group', { name: 'Pictures' })).toBeVisible()
  await userEvent.click(open)
  expect(screen.getByRole('dialog', { name: 'The worn suffix, boxed' })).toHaveTextContent(
    'Picture 1 of 4 · Which ATmega328P variant is this?',
  )
})
