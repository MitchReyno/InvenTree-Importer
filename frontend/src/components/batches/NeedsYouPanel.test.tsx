import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { BatchAttentionDto } from '@invimport/contracts'
import { describe, expect, it } from 'vitest'
import { NeedsYouPanel } from './NeedsYouPanel'

const noSteps = {
  examine: { questions: 0, failed: 0, jobs: 0, ready: 0, running: 0 },
  research: { questions: 0, failed: 0, jobs: 0, ready: 0, running: 0 },
  images: { questions: 0, failed: 0, jobs: 0, ready: 0, running: 0 },
  inventory: { questions: 0, failed: 0, jobs: 0, ready: 0, running: 0 },
}

const b = 'b0000000-0000-4000-8000-000000000001'
const run = 'r0000000-0000-4000-8000-000000000002'

const attention: BatchAttentionDto = {
  batch_id: b,
  revision: '3',
  processing: { questions: 1, failed: 0, running: 0, steps: noSteps },
  review: { to_check: 1, changed_after_review: 1, needs_answer: 0, to_decide: 0, records: 0 },
  changes: { ready: 0, failed: 1, uncertain: 0, runs: 0 },
  items: [
    {
      key: 'question:q',
      group: 'question',
      tab: 'processing',
      title: 'Is this 10kΩ?',
      detail: 'Assuming 10kΩ',
      route: `${b}/processing/examine/q`,
    },
    {
      key: 'changed:l',
      group: 'changed_lot',
      tab: 'review',
      title: 'Resistor bag',
      detail: 'Changed since it was reviewed',
      route: `${b}/review/lots/l`,
    },
    {
      key: `result:${run}`,
      group: 'result',
      tab: 'changes',
      title: 'A run needs recovery',
      detail: null,
      route: `${b}/changes/added/${run}`,
    },
  ],
  items_truncated: false,
}

describe('NeedsYouPanel', () => {
  it('lists every open item grouped by its tab, each linking to its owner', async () => {
    const user = userEvent.setup()
    render(<NeedsYouPanel attention={attention} />)

    await user.click(screen.getByRole('button', { name: '3 need you' }))
    const panel = screen.getByRole('dialog', { name: 'Needs you' })

    expect(
      within(panel)
        .getAllByRole('heading')
        .map((heading) => heading.textContent),
    ).toEqual(['Needs you3', 'Questions · Processing', 'Lots · Review', 'Results · Changes'])
    expect(within(panel).getByRole('link', { name: 'Open: A run needs recovery' })).toHaveAttribute(
      'href',
      `#${b}/changes/added/${run}`,
    )
    expect(within(panel).getByText('Assuming 10kΩ')).toBeVisible()
    expect(
      within(panel).getByText('Each item opens the tab that owns it.', { exact: false }),
    ).toBeVisible()
  })

  it('closes once an item is chosen, so it does not cover the screen it opens', async () => {
    const user = userEvent.setup()
    render(<NeedsYouPanel attention={attention} />)

    await user.click(screen.getByRole('button', { name: '3 need you' }))
    await user.click(screen.getByRole('link', { name: 'Open: A run needs recovery' }))

    expect(screen.queryByRole('dialog', { name: 'Needs you' })).not.toBeInTheDocument()
  })

  it('names each question by its step and marks other items by tone, never colour alone', async () => {
    const user = userEvent.setup()
    render(<NeedsYouPanel attention={attention} />)
    await user.click(screen.getByRole('button', { name: '3 need you' }))
    const panel = screen.getByRole('dialog', { name: 'Needs you' })

    const question = within(panel)
      .getByRole('link', { name: 'Answer: Is this 10kΩ?' })
      .closest('li')!
    expect(question).toHaveTextContent('Examine')
    const changed = within(panel).getByRole('link', { name: 'Check: Resistor bag' }).closest('li')!
    expect(within(changed).getByText('Changed since review')).toBeInTheDocument()
    expect(changed.querySelector('[data-tone="warn"]')).toHaveTextContent('!')
    const result = within(panel)
      .getByRole('link', { name: 'Open: A run needs recovery' })
      .closest('li')!
    expect(result.querySelector('[data-tone="bad"]')).toHaveTextContent('×')
  })

  it('closes from its own close button and returns focus to the pill', async () => {
    const user = userEvent.setup()
    render(<NeedsYouPanel attention={attention} />)
    const pill = screen.getByRole('button', { name: '3 need you' })

    await user.click(pill)
    await user.click(screen.getByRole('button', { name: 'Close Needs you' }))

    expect(screen.queryByRole('dialog', { name: 'Needs you' })).not.toBeInTheDocument()
    expect(pill).toHaveFocus()
  })

  it('closes with Escape and returns focus to the pill', async () => {
    const user = userEvent.setup()
    render(<NeedsYouPanel attention={attention} />)
    const pill = screen.getByRole('button', { name: '3 need you' })

    await user.click(pill)
    await user.keyboard('{Escape}')

    expect(screen.queryByRole('dialog', { name: 'Needs you' })).not.toBeInTheDocument()
    expect(pill).toHaveFocus()
  })

  it('says when nothing needs the operator and when the list is truncated', () => {
    const { rerender } = render(<NeedsYouPanel attention={{ ...attention, items: [] }} />)
    expect(screen.getByText('Nothing needs you')).toBeInTheDocument()

    rerender(<NeedsYouPanel attention={{ ...attention, items_truncated: true }} />)
    expect(screen.getByRole('button', { name: '3+ need you' })).toBeInTheDocument()
  })
})

describe('NeedsYouPanel question rows', () => {
  it('show each question with its kind or step count and the agent’s assumptions', async () => {
    const user = userEvent.setup()

    const question = (
      key: string,
      title: string,
      steps: NonNullable<BatchAttentionDto['items'][number]['question']>['steps'],
    ) => ({
      key,
      group: 'question' as const,
      tab: 'processing' as const,
      title,
      detail: steps[0].assumption,
      question: { steps },
      route: `${b}/processing/examine/${key}`,
    })

    render(
      <NeedsYouPanel
        attention={{
          ...attention,
          items: [
            question('q1', 'About the 10 kΩ packets', [
              { kind: 'choice', options: 2, assumption: 'Same Part' },
              { kind: 'number', assumption: '~380 left' },
              { kind: 'choice', options: 2, assumption: 'Drawer R3' },
            ]),
            question('q2', 'Which ATmega328P variant is this?', [
              { kind: 'choice', options: 2, assumption: 'ATmega328P-AU' },
            ]),
            question('q3', 'How many 1N4148 diodes are in the bag?', [
              { kind: 'number', assumption: 'Using 200 (estimate)' },
            ]),
            question('q4', 'Is the label torn?', [{ kind: 'text', assumption: null }]),
          ],
        }}
      />,
    )
    await user.click(screen.getByRole('button', { name: '4 need you' }))
    const rows = within(screen.getByRole('dialog', { name: 'Needs you' })).getAllByRole('listitem')
    expect(rows[0]).toHaveTextContent('About the 10 kΩ packets · 3 steps')
    expect(rows[0]).toHaveTextContent('Same Part · ~380 left · Drawer R3')
    expect(rows[1]).toHaveTextContent('Which ATmega328P variant is this? · choose one of 2')
    expect(rows[1]).toHaveTextContent('ATmega328P-AU')
    expect(rows[2]).toHaveTextContent('· a number')
    expect(rows[2]).toHaveTextContent('Using 200 (estimate)')
    // An earlier runner question recorded no assumption.
    expect(rows[3]).toHaveTextContent('Is the label torn? · in words')
  })
})
