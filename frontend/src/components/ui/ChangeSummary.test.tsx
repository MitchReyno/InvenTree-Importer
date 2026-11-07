import { render, screen, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { Button } from './Button'
import { ChangeSummary } from './ChangeSummary'
import { Pill } from './Pill'
import { StickyFooter } from './StickyFooter'

describe('ChangeSummary', () => {
  it('groups changes under titled sections with counts and links', () => {
    render(
      <ChangeSummary
        sections={[
          {
            title: 'New Parts',
            count: 2,
            items: [
              {
                id: 'p1',
                label: 'RC0603FR-0710KL',
                href: '#review/p1',
                pill: <Pill tone="info">New</Pill>,
              },
              { id: 'p2', label: 'GRM188R71H104KA93D' },
            ],
          },
        ]}
      />,
    )
    const section = screen.getByRole('region', { name: 'New Parts, 2' })

    expect(within(section).getByRole('link', { name: 'RC0603FR-0710KL' })).toHaveAttribute(
      'href',
      '#review/p1',
    )
    expect(within(section).getByText('GRM188R71H104KA93D')).toBeInTheDocument()
    expect(within(section).getByText('New')).toBeInTheDocument()
  })
})

describe('StickyFooter', () => {
  it('publishes its height for toasts while mounted', () => {
    const { unmount } = render(
      <StickyFooter label="Ready to add" summary="6 items" primary={<Button>Add</Button>} />,
    )

    expect(document.documentElement.style.getPropertyValue('--sticky-footer-height')).toBe('0px')
    unmount()
    expect(document.documentElement.style.getPropertyValue('--sticky-footer-height')).toBe('')
  })

  it('holds the summary and the primary action', () => {
    render(
      <StickyFooter
        label="Ready to add"
        summary="6 items ready"
        primary={
          <Button variant="primary" size="lg">
            Add 6 items
          </Button>
        }
      />,
    )

    expect(screen.getByRole('region', { name: 'Ready to add' })).toHaveTextContent('6 items ready')
    expect(screen.getByRole('button', { name: 'Add 6 items' })).toBeInTheDocument()
  })
})
