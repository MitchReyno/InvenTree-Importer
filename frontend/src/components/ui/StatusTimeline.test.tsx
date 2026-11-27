import { render, screen, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { eventTimeText } from './EventTime'
import { NeedsYou } from './NeedsYou'
import { StatusTimeline } from './StatusTimeline'

describe('StatusTimeline', () => {
  it('lists entries oldest first and marks the current one', () => {
    render(
      <StatusTimeline
        label="Examine session"
        entries={[
          { text: 'Read 6 photos', at: '2026-11-20T10:02:00Z' },
          { text: 'Formed 4 lots', at: '2026-11-20T10:04:00Z', current: true },
        ]}
      />,
    )
    const items = within(screen.getByRole('list', { name: 'Examine session' })).getAllByRole(
      'listitem',
    )

    // Each entry's time says which day, in the one event-time format.
    expect(items[0]).toHaveTextContent(
      `Read 6 photos${eventTimeText('2026-11-20T10:02:00Z', Date.now())}`,
    )
    expect(items[1]).toHaveAttribute('aria-current', 'step')
    expect(items[0].querySelector('time')).toHaveAttribute('datetime', '2026-11-20T10:02:00Z')
  })

  it('leaves the time out of an entry without one', () => {
    render(<StatusTimeline label="Activity" entries={[{ text: 'Round 1 approved' }]} />)

    expect(screen.getByRole('listitem').querySelector('time')).toBeNull()
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

    expect(screen.getByRole('link', { name: 'Answer: Resistor value' })).toHaveAttribute(
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
