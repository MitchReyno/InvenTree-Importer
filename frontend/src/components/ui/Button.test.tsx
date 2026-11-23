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

  it('gives a quiet reason that stays focusable, adds no layout and ignores presses', async () => {
    const onClick = vi.fn()
    render(
      <Button reasonDisplay="quiet" disabledReason="Updating…" onClick={onClick}>
        Mark selected reviewed
      </Button>,
    )
    const button = screen.getByRole('button', { name: 'Mark selected reviewed' })

    expect(button).not.toBeDisabled()
    expect(button).toHaveAttribute('aria-disabled', 'true')
    expect(button).toHaveAccessibleDescription('Updating…')
    // The reason is a tooltip, drawn over the page rather than beside the button.
    expect(screen.getByRole('tooltip', { hidden: true })).toHaveTextContent('Updating…')

    await userEvent.tab()
    expect(button).toHaveFocus()
    await userEvent.keyboard('{Enter}')
    await userEvent.click(button)
    expect(onClick).not.toHaveBeenCalled()
  })

  it('keeps the same button when a quiet reason clears, so focus stays', async () => {
    const onClick = vi.fn()
    const { rerender } = render(
      <Button reasonDisplay="quiet" disabledReason="Updating…" onClick={onClick}>
        Pause all
      </Button>,
    )
    const button = screen.getByRole('button', { name: 'Pause all' })
    button.focus()

    rerender(
      <Button reasonDisplay="quiet" onClick={onClick}>
        Pause all
      </Button>,
    )
    expect(screen.getByRole('button', { name: 'Pause all' })).toBe(button)
    expect(button).toHaveFocus()
    expect(button).not.toHaveAttribute('aria-disabled')
    await userEvent.click(button)
    expect(onClick).toHaveBeenCalledTimes(1)
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

  it('gives links no busy or disabled state', () => {
    render(
      <>
        {/* @ts-expect-error Links navigate; busy belongs to buttons. */}
        <Button as="a" href="#a" busy>
          A
        </Button>
        {/* @ts-expect-error Links navigate; a disabled reason belongs to buttons. */}
        <Button as="a" href="#b" disabledReason="No">
          B
        </Button>
      </>,
    )

    expect(screen.getByRole('link', { name: 'A' })).not.toHaveAttribute('aria-busy')
  })

  it('defaults to a non-submitting button', () => {
    render(<Button>Retry</Button>)

    expect(screen.getByRole('button', { name: 'Retry' })).toHaveAttribute('type', 'button')
  })
})
