import { render, screen, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { SubTabs, Tabs, type TabItem } from './Tabs'

const items: TabItem[] = [
  { id: 'capture', label: 'Capture', href: '#b1/capture' },
  {
    id: 'review',
    label: 'Review',
    href: '#b1/review',
    count: 8,
    countLabel: 'to check',
    badge: { label: '3 to decide', tone: 'warn' },
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
    expect(
      within(nav).getByRole('link', { name: 'Review, 8 to check, 3 to decide' }),
    ).toHaveAttribute('aria-current', 'page')
    expect(within(nav).getByRole('link', { name: 'Capture' })).not.toHaveAttribute('aria-current')
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
  it('shows counts, badges and a running spinner on second-row items', () => {
    render(
      <SubTabs
        label="Review views"
        current="lots"
        items={[
          { id: 'lots', label: 'Lots', href: '#b1/review/lots', count: 12 },
          { id: 'records', label: 'Records', href: '#b1/review/records', spinner: true },
        ]}
      />,
    )

    expect(screen.getByRole('link', { name: 'Lots, 12' })).toHaveAttribute('aria-current', 'page')
    expect(
      screen.getByRole('link', { name: 'Records' }).querySelector('[aria-hidden="true"]'),
    ).not.toBeNull()
  })
})
