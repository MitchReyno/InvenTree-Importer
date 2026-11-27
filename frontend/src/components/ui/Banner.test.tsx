import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { Banner } from './Banner'
import { Button } from './Button'

describe('Banner', () => {
  it('shows its message with a decorative tone glyph and an optional action', () => {
    render(
      <Banner tone="warn" action={<Button size="sm">Answer</Button>}>
        2 questions need an answer before approval.
      </Banner>,
    )
    const message = screen.getByText('2 questions need an answer before approval.')

    expect(message).toBeVisible()
    expect(screen.getByRole('button', { name: 'Answer' })).toBeInTheDocument()
    expect(message.parentElement?.querySelector('[aria-hidden="true"]')).toHaveTextContent('!')
  })

  it('is not a live region', () => {
    render(<Banner tone="info">Processing runs in the background.</Banner>)

    expect(screen.queryByRole('status')).not.toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })
})
