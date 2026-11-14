import { render, screen, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { Breadcrumb } from './Breadcrumb'

describe('Breadcrumb', () => {
  it('links earlier items and marks the last as the current page', () => {
    render(
      <Breadcrumb
        items={[{ label: 'Batches', href: '#' }, { label: 'Mouser 3381-22 + bench bag' }]}
      />,
    )
    const nav = screen.getByRole('navigation', { name: 'Breadcrumb' })

    expect(within(nav).getByRole('link', { name: 'Batches' })).toHaveAttribute('href', '#')
    const current = within(nav).getByText('Mouser 3381-22 + bench bag')
    expect(current).toHaveAttribute('aria-current', 'page')
    expect(current).toHaveAttribute('title', 'Mouser 3381-22 + bench bag')
  })

  it('reads "Batches" alone inside a batch, since the batch header names the batch', () => {
    render(<Breadcrumb items={[{ label: 'Batches', href: '#' }]} />)
    const nav = screen.getByRole('navigation', { name: 'Breadcrumb' })

    expect(within(nav).getByRole('link', { name: 'Batches' })).toHaveAttribute('href', '#')
    expect(nav).toHaveTextContent(/^Batches$/)
  })
})
