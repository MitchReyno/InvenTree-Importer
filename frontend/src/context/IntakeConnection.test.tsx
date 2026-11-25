import { act, fireEvent, render, screen } from '@testing-library/react'
import { expect, test, vi } from 'vitest'
import { IntakeConnectionProvider, useIntakeConnection } from './IntakeConnection'

function Observer() {
  const state = useIntakeConnection()
  return <button onClick={state?.confirm}>{state?.contact}</button>
}

test('resuming after twelve seconds marks stale contact and coalesces confirmations during a pending read', async () => {
  vi.useFakeTimers()
  let finish!: () => void
  const read = vi
    .fn<() => Promise<void>>()
    .mockResolvedValueOnce(undefined)
    .mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve
        }),
    )
    .mockRejectedValueOnce(new Error('offline'))
  const view = render(
    <IntakeConnectionProvider
      read={read}
      bootstrapFailed={false}
      refreshBootstrap={() => undefined}
    >
      <Observer />
    </IntakeConnectionProvider>,
  )
  try {
    await act(async () => {})
    expect(screen.getByRole('button')).toHaveTextContent('connected')
    vi.setSystemTime(Date.now() + 12_000)
    fireEvent.focus(window)
    expect(screen.getByRole('button')).toHaveTextContent('checking')
    fireEvent.click(screen.getByRole('button'))
    fireEvent.click(screen.getByRole('button'))
    expect(read).toHaveBeenCalledTimes(2)
    await act(async () => {
      finish()
    })
    await act(async () => vi.advanceTimersByTimeAsync(1))
    expect(read).toHaveBeenCalledTimes(3)
    expect(screen.getByRole('button')).toHaveTextContent('disconnected')
  } finally {
    view.unmount()
    vi.useRealTimers()
  }
})
