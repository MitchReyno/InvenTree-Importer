import { render, screen, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { SubTabs, Tabs, type TabItem } from './Tabs'

const items: TabItem[] = [
  { id: 'capture', label: 'Capture', href: '#b1/capture' },
  {
    id: 'review',
    label: 'Review',
    href: '#b1/review',
    count: { value: '8', label: '8 to check', tone: 'default' },
  },
  { id: 'changes', label: 'Changes', href: '#b1/changes', disabled: true },
]

describe('Tabs', () => {
  it('is a labelled navigation list of links with the current page marked', () => {
    render(<Tabs label="Batch" items={items} current="review" />)
    const nav = screen.getByRole('navigation', { name: 'Batch' })

    expect(within(nav).getByRole('link', { name: 'Capture' })).toHaveAttribute(
      'href',
      '#b1/capture',
    )
    expect(within(nav).getByRole('link', { name: 'Review, 8 to check' })).toHaveAttribute(
      'aria-current',
      'page',
    )
    expect(within(nav).getByRole('link', { name: 'Capture' })).not.toHaveAttribute('aria-current')
  })

  it('shows one count as a number in its tone, with its words only in the accessible name', () => {
    render(<Tabs label="Batch" items={items} current="review" />)
    const review = screen.getByRole('link', { name: 'Review, 8 to check' })

    expect(review).toHaveTextContent(/^Review8$/)
    expect(review.querySelector('[data-tone="default"]')).toHaveTextContent('8')
  })

  it('renders a disabled item without a destination and out of the tab order', () => {
    render(<Tabs label="Batch" items={items} current="review" />)
    const disabled = screen.getByText('Changes').closest('a')!

    expect(disabled).not.toHaveAttribute('href')
    expect(disabled).toHaveAttribute('aria-disabled', 'true')
    expect(disabled).toHaveAttribute('tabindex', '-1')
  })
})

describe('SubTabs', () => {
  it('shows a spinner while running and a tick when done, each named in words', () => {
    render(
      <SubTabs
        label="Processing steps"
        current="research"
        items={[
          { id: 'examine', label: 'Examine', href: '#e', status: 'done' },
          {
            id: 'research',
            label: 'Research',
            href: '#r',
            status: 'running',
            count: { value: '7/12', label: '7 of 12 ready', tone: 'default' },
          },
        ]}
      />,
    )

    const examine = screen.getByRole('link', { name: 'Examine, done' })
    expect(examine).toHaveTextContent('✓')
    const research = screen.getByRole('link', { name: 'Research, running, 7 of 12 ready' })
    expect(research).toHaveAttribute('aria-current', 'page')
    expect(research).toHaveTextContent('7/12')
    // The spinner itself is decorative; the name says the work is running.
    expect(research.querySelector('[aria-hidden="true"]')).not.toBeNull()
  })
})
