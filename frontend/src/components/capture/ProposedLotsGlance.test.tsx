import { render, screen, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { ProposedLotsGlance } from './ProposedLotsGlance'

const lots = [
  {
    id: 'l1',
    label: '10 kΩ resistor 0603 — packet A',
    state: 'ready' as const,
    href: '#b/review/lots/l1',
  },
  { id: 'l2', label: 'ATmega328P', state: 'blocked' as const, href: '#b/review/lots/l2' },
]

describe('ProposedLotsGlance', () => {
  it('lists each lot with its state and opens it in Review, without edit controls', () => {
    render(<ProposedLotsGlance batchId="b" lots={lots} />)
    const glance = screen.getByRole('region', { name: 'Proposed lots, 2' })

    expect(
      within(glance).getByRole('link', { name: '10 kΩ resistor 0603 — packet A' }),
    ).toHaveAttribute('href', '#b/review/lots/l1')
    expect(within(glance).getByText('Ready')).toBeInTheDocument()
    expect(within(glance).getByText('Blocked')).toBeInTheDocument()
    expect(within(glance).queryByRole('textbox')).not.toBeInTheDocument()
    expect(within(glance).queryByRole('button')).not.toBeInTheDocument()
    expect(within(glance).getByRole('link', { name: 'Open Review' })).toHaveAttribute(
      'href',
      '#b/review/lots',
    )
  })

  it('says when no lots are proposed yet', () => {
    render(<ProposedLotsGlance batchId="b" lots={[]} />)

    expect(screen.getByText(/No lots yet/)).toBeInTheDocument()
  })
})
