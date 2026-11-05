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

  it('announces politely and dismisses after its duration', () => {
    const onDismiss = vi.fn()
    render(<Toast message="Lot moved" onDismiss={onDismiss} />)

    expect(screen.getByRole('status')).toHaveTextContent('Lot moved')
    act(() => vi.advanceTimersByTime(4999))
    expect(onDismiss).not.toHaveBeenCalled()
    act(() => vi.advanceTimersByTime(1))
    expect(onDismiss).toHaveBeenCalledTimes(1)
  })

  it('pauses the timer while hovered or focused', () => {
    const onDismiss = vi.fn()
    render(<Toast message="Lot moved" durationMs={1000} onDismiss={onDismiss} />)
    const toast = screen.getByRole('status')

    fireEvent.mouseEnter(toast)
    act(() => vi.advanceTimersByTime(3000))
    expect(onDismiss).not.toHaveBeenCalled()

    fireEvent.mouseLeave(toast)
    act(() => vi.advanceTimersByTime(1000))
    expect(onDismiss).toHaveBeenCalledTimes(1)
  })

  it('stays paused while its action keeps focus after the pointer leaves', () => {
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
    act(() => vi.advanceTimersByTime(3000))
    expect(onDismiss).not.toHaveBeenCalled()

    fireEvent.blur(screen.getByRole('button', { name: 'Undo' }))
    act(() => vi.advanceTimersByTime(1000))
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
