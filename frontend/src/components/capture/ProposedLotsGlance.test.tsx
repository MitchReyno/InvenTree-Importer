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

  it('shows each lot’s latest agent status line under it', () => {
    render(
      <ProposedLotsGlance
        batchId="b"
        lots={[{ ...lots[0], status: 'Research · Checking the datasheet' }, lots[1]]}
      />,
    )
    expect(screen.getByRole('listitem', { name: lots[0].label })).toHaveTextContent(
      'Research · Checking the datasheet',
    )
    expect(screen.getByRole('listitem', { name: 'ATmega328P' })).not.toHaveTextContent('·')
  })

  it('says when no lots are proposed yet', () => {
    render(<ProposedLotsGlance batchId="b" lots={[]} />)

    expect(screen.getByText(/No lots yet/)).toBeInTheDocument()
  })
})

describe('ProposedLotsGlance with lead-session lots', () => {
  it('badges AI-proposed and edited lots and shows their observation crops', () => {
    render(
      <ProposedLotsGlance
        batchId="b"
        lots={[
          {
            id: 'l3',
            label: 'LED 0603 red',
            state: 'to_review',
            href: '#b/review/lots/l3',
            origin: 'agent',
            edited: false,
            crops: [
              {
                src: '/crop/o1',
                srcSet: '/crop/o1?size=thumb 320w',
                sizes: '40px',
                width: 40,
                height: 40,
              },
              { src: '/crop/o2', width: 40, height: 40 },
            ],
            suggestions: 1,
          },
          {
            id: 'l4',
            label: '16 MHz crystal',
            state: 'to_review',
            href: '#b/review/lots/l4',
            origin: 'agent',
            edited: true,
            crops: [],
            suggestions: 0,
          },
        ]}
        leadStatus="Grouping the reel photos"
      />,
    )
    const led = screen.getByRole('listitem', { name: 'LED 0603 red' })
    expect(within(led).getByText('AI-proposed')).toBeInTheDocument()
    expect(within(led).getAllByRole('img')).toHaveLength(2)
    expect(within(led).getAllByRole('img')[0]).toHaveAttribute('srcset', '/crop/o1?size=thumb 320w')
    expect(within(led).getAllByRole('img')[0]).toHaveAttribute('sizes', '40px')
    expect(within(led).getByText('1 suggestion')).toBeInTheDocument()
    const crystal = screen.getByRole('listitem', { name: '16 MHz crystal' })
    expect(within(crystal).getByText('Edited')).toBeInTheDocument()
    expect(within(crystal).queryByText('AI-proposed')).not.toBeInTheDocument()
    expect(screen.getByRole('status')).toHaveTextContent('Grouping the reel photos')
  })
})

it('shows no stray count for an AI lot without crops or suggestions', () => {
  render(
    <ProposedLotsGlance
      batchId="b"
      lots={[
        {
          id: 'l5',
          label: 'Document line lot',
          state: 'to_review',
          href: '#b/review/lots/l5',
          origin: 'agent',
          edited: false,
          crops: [],
          suggestions: 0,
        },
      ]}
    />,
  )
  expect(screen.getByRole('listitem', { name: 'Document line lot' })).not.toHaveTextContent(/^.*0$/)
})
