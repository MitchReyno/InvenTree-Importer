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

describe('step progress and short badges', () => {
  it('names a finished step done and a working step by how many attempts are ready', () => {
    render(
      <SubTabs
        label="Processing steps"
        current="research"
        items={[
          { id: 'examine', label: 'Examine', href: '#e', progress: { ready: 3, of: 3 } },
          { id: 'research', label: 'Research', href: '#r', progress: { ready: 7, of: 12 } },
        ]}
      />,
    )

    expect(screen.getByRole('link', { name: 'Examine, done' })).toBeInTheDocument()
    const research = screen.getByRole('link', { name: 'Research, 7 of 12 ready' })
    expect(research).toHaveTextContent('7 of 12')
  })

  it('keeps the badge words for assistive technology when phone width shows only its number', () => {
    render(
      <Tabs
        label="Batch"
        current="review"
        items={[
          {
            id: 'review',
            label: 'Review',
            href: '#r',
            badge: { label: '3 to decide', short: '3', tone: 'warn' },
          },
        ]}
      />,
    )

    const link = screen.getByRole('link', { name: 'Review, 3 to decide' })
    expect(link).toHaveTextContent('3 to decide')
  })
})
