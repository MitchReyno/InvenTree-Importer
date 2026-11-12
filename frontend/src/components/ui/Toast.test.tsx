import { act, fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Toast } from './Toast'

describe('Toast', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('announces politely, then fades out before it is dismissed', async () => {
    const onDismiss = vi.fn()
    render(<Toast message="Lot moved" onDismiss={onDismiss} />)

    expect(screen.getByRole('status')).toHaveTextContent('Lot moved')
    await act(() => vi.advanceTimersByTime(4999))
    expect(screen.getByRole('status')).toHaveAttribute('data-state', 'open')
    await act(() => vi.advanceTimersByTime(1))
    expect(screen.getByRole('status')).toHaveAttribute('data-state', 'leaving')
    expect(onDismiss).not.toHaveBeenCalled()
    await act(() => vi.advanceTimersByTime(120))
    expect(onDismiss).toHaveBeenCalledTimes(1)
  })

  it('pauses the timer while hovered or focused', async () => {
    const onDismiss = vi.fn()
    render(<Toast message="Lot moved" durationMs={1000} onDismiss={onDismiss} />)
    const toast = screen.getByRole('status')

    fireEvent.mouseEnter(toast)
    await act(() => vi.advanceTimersByTime(3000))
    expect(onDismiss).not.toHaveBeenCalled()

    fireEvent.mouseLeave(toast)
    await act(() => vi.advanceTimersByTime(1000))
    await act(() => vi.advanceTimersByTime(120))
    expect(onDismiss).toHaveBeenCalledTimes(1)
  })

  it('stays paused while its action keeps focus after the pointer leaves', async () => {
    const onDismiss = vi.fn()
    render(
      <Toast
        message="Lot moved"
        durationMs={1000}
        action={{ label: 'Undo', onClick: () => {} }}
        onDismiss={onDismiss}
      />,
    )
    const toast = screen.getByRole('status')

    fireEvent.mouseEnter(toast)
    fireEvent.focus(screen.getByRole('button', { name: 'Undo' }))
    fireEvent.mouseLeave(toast)
    await act(() => vi.advanceTimersByTime(3000))
    expect(onDismiss).not.toHaveBeenCalled()

    fireEvent.blur(screen.getByRole('button', { name: 'Undo' }))
    await act(() => vi.advanceTimersByTime(1000))
    await act(() => vi.advanceTimersByTime(120))
    expect(onDismiss).toHaveBeenCalledTimes(1)
  })

  it('runs its action', async () => {
    vi.useRealTimers()
    const onClick = vi.fn()
    render(<Toast message="Lot moved" action={{ label: 'Undo', onClick }} onDismiss={() => {}} />)

    await userEvent.click(screen.getByRole('button', { name: 'Undo' }))
    expect(onClick).toHaveBeenCalledTimes(1)
  })
})
