import { render, screen, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { Button } from './Button'
import { ProblemCard, ProblemList } from './ProblemCard'

describe('ProblemCard', () => {
  it('names the severity in words and lists each issue with its actions', () => {
    render(
      <ProblemCard
        severity="blocking"
        title="Part not chosen"
        summary="2 lots"
        issues={[
          {
            title: 'Resistor bag',
            text: 'Two Parts match the label.',
            actions: <Button size="sm">Choose Part</Button>,
          },
        ]}
      />,
    )
    const card = screen.getByRole('region', { name: 'Blocking: Part not chosen' })

    expect(within(card).getByText('2 lots')).toBeVisible()
    expect(within(card).getByText('Two Parts match the label.')).toBeVisible()
    expect(within(card).getByRole('button', { name: 'Choose Part' })).toBeInTheDocument()
  })

  it('renders blocking problems before warnings', () => {
    render(
      <ProblemList
        problems={[
          { id: 'w', severity: 'warning', title: 'Low certainty', issues: [] },
          { id: 'b', severity: 'blocking', title: 'Quantity missing', issues: [] },
        ]}
      />,
    )
    const regions = screen.getAllByRole('region')

    expect(regions.map((region) => region.getAttribute('aria-label'))).toEqual([
      'Blocking: Quantity missing',
      'Warning: Low certainty',
    ])
  })
})
