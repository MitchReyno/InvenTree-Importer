import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { BatchAttentionDto } from '@invimport/contracts'
import { describe, expect, it } from 'vitest'
import { NeedYouPanel } from './NeedYouPanel'

const b = 'b0000000-0000-4000-8000-000000000001'
const run = 'r0000000-0000-4000-8000-000000000002'

const attention: BatchAttentionDto = {
  batch_id: b,
  revision: '3',
  processing: { questions: 1, failed: 0 },
  review: { to_check: 1, changed_after_review: 1, to_decide: 0 },
  changes: { ready: 0, failed: 1, uncertain: 0 },
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

describe('NeedYouPanel', () => {
  it('lists every open item grouped by its tab, each linking to its owner', async () => {
    const user = userEvent.setup()
    render(<NeedYouPanel attention={attention} />)

    await user.click(screen.getByRole('button', { name: '3 need you' }))
    const panel = screen.getByRole('dialog', { name: 'Needs you' })

    expect(
      within(panel)
        .getAllByRole('heading')
        .map((heading) => heading.textContent),
    ).toEqual(['Processing', 'Review', 'Changes'])
    expect(within(panel).getByRole('link', { name: 'A run needs recovery' })).toHaveAttribute(
      'href',
      `#${b}/changes/added/${run}`,
    )
    expect(within(panel).getByText('Assuming 10kΩ')).toBeVisible()
  })

  it('closes once an item is chosen, so it does not cover the screen it opens', async () => {
    const user = userEvent.setup()
    render(<NeedYouPanel attention={attention} />)

    await user.click(screen.getByRole('button', { name: '3 need you' }))
    await user.click(screen.getByRole('link', { name: 'A run needs recovery' }))

    expect(screen.queryByRole('dialog', { name: 'Needs you' })).not.toBeInTheDocument()
  })

  it('closes with Escape and returns focus to the pill', async () => {
    const user = userEvent.setup()
    render(<NeedYouPanel attention={attention} />)
    const pill = screen.getByRole('button', { name: '3 need you' })

    await user.click(pill)
    await user.keyboard('{Escape}')

    expect(screen.queryByRole('dialog', { name: 'Needs you' })).not.toBeInTheDocument()
    expect(pill).toHaveFocus()
  })

  it('says when nothing needs the operator and when the list is truncated', () => {
    const { rerender } = render(<NeedYouPanel attention={{ ...attention, items: [] }} />)
    expect(screen.getByText('Nothing needs you')).toBeInTheDocument()

    rerender(<NeedYouPanel attention={{ ...attention, items_truncated: true }} />)
    expect(screen.getByRole('button', { name: '3+ need you' })).toBeInTheDocument()
  })
})
