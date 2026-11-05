import { render, screen, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { NeedsYou } from './NeedsYou'
import { StatusTimeline } from './StatusTimeline'

describe('StatusTimeline', () => {
  it('lists entries oldest first and marks the current one', () => {
    render(
      <StatusTimeline
        label="Examine session"
        entries={[
          { text: 'Read 6 photos', time: '10:02' },
          { text: 'Formed 4 lots', time: '10:04', current: true },
        ]}
      />,
    )
    const items = within(screen.getByRole('list', { name: 'Examine session' })).getAllByRole(
      'listitem',
    )

    expect(items[0]).toHaveTextContent('Read 6 photos10:02')
    expect(items[1]).toHaveAttribute('aria-current', 'step')
  })
})

describe('NeedsYou', () => {
  it('links each item to its owner with the assumption in use', () => {
    render(
      <NeedsYou
        items={[
          {
            id: 'q1',
            title: 'Resistor value',
            assumption: 'Assuming 10kΩ',
            step: 'Research',
            href: '#b1/processing/research?question=q1',
          },
        ]}
      />,
    )

    expect(screen.getByRole('link', { name: 'Resistor value' })).toHaveAttribute(
      'href',
      '#b1/processing/research?question=q1',
    )
    expect(screen.getByText('Assuming 10kΩ')).toBeInTheDocument()
    expect(screen.getByText('Research')).toBeInTheDocument()
  })

  it('says plainly when nothing needs the operator', () => {
    render(<NeedsYou items={[]} />)

    expect(screen.getByText('Nothing needs you right now.')).toBeInTheDocument()
  })
})
