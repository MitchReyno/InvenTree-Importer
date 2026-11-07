import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { describe, expect, it } from 'vitest'
import { PhaseRow } from './PhaseRow'
import { Pill } from './Pill'

function Phase() {
  const [expanded, setExpanded] = useState(false)
  return (
    <PhaseRow
      state="running"
      title="Research"
      outcome="4 of 9 lots researched"
      badges={<Pill tone="warn">1 question</Pill>}
      expanded={expanded}
      onToggle={() => setExpanded((open) => !open)}
    >
      <p>Lot details</p>
    </PhaseRow>
  )
}

describe('PhaseRow', () => {
  it('is a disclosure naming the step, its state and outcome', async () => {
    render(<Phase />)
    const toggle = screen.getByRole('button', { name: /Research/ })

    expect(toggle).toHaveTextContent('Running')
    expect(toggle).toHaveTextContent('4 of 9 lots researched')
    expect(toggle).toHaveAttribute('aria-expanded', 'false')
    expect(screen.queryByText('Lot details')).not.toBeInTheDocument()

    await userEvent.click(toggle)
    expect(toggle).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByText('Lot details')).toBeVisible()
    expect(toggle).toHaveAttribute(
      'aria-controls',
      screen.getByText('Lot details').parentElement!.id,
    )
  })
})
