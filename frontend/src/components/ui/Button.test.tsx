import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { Button } from './Button'

describe('Button', () => {
  it('renders a named button that runs its action', async () => {
    const onClick = vi.fn()
    render(
      <Button variant="primary" icon="+" onClick={onClick}>
        Add evidence
      </Button>,
    )

    await userEvent.click(screen.getByRole('button', { name: 'Add evidence' }))
    expect(onClick).toHaveBeenCalledTimes(1)
  })

  it('states why it is disabled and links the reason', () => {
    render(<Button disabledReason="Answer the open question first">Approve 3 items</Button>)
    const button = screen.getByRole('button', { name: 'Approve 3 items' })

    expect(button).toBeDisabled()
    expect(button).toHaveAccessibleDescription('Answer the open question first')
    expect(screen.getByText('Answer the open question first')).toBeVisible()
  })

  it('keeps its label while busy and ignores repeat clicks', async () => {
    const onClick = vi.fn()
    render(
      <Button busy onClick={onClick}>
        Saving
      </Button>,
    )
    const button = screen.getByRole('button', { name: 'Saving' })

    expect(button).toHaveAttribute('aria-busy', 'true')
    await userEvent.click(button)
    expect(onClick).not.toHaveBeenCalled()
  })

  it('renders as a link when asked', () => {
    render(
      <Button as="a" href="#settings" variant="ghost" size="sm">
        Agent settings
      </Button>,
    )

    expect(screen.getByRole('link', { name: 'Agent settings' })).toHaveAttribute(
      'href',
      '#settings',
    )
  })

  it('defaults to a non-submitting button', () => {
    render(<Button>Retry</Button>)

    expect(screen.getByRole('button', { name: 'Retry' })).toHaveAttribute('type', 'button')
  })
})
