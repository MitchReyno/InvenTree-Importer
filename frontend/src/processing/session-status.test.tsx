import { renderHook, waitFor } from '@testing-library/react'
import { expect, it, vi } from 'vitest'
import { SESSION_STATUS_REFRESH_MS, useSessionStatuses } from './session-status'
import type { ProcessingClient } from './types'
import type { ReactNode } from 'react'
import { ServerStateProvider } from '#/components/query/ServerStateProvider'
import { fixtureScope } from '#/test/render'

function wrapper({ children }: { children: ReactNode }) {
  return <ServerStateProvider scope={fixtureScope}>{children}</ServerStateProvider>
}

const job = (id: string, stage: string, subject: string | null, text: string | null, at = '') => ({
  id,
  stage,
  subject_id: subject,
  session_state: 'running',
  ...(text ? { latest_status: { text, at } } : {}),
})

it('reads the lead session’s line and each lot’s newest line, re-reading when the revision moves', async () => {
  const read = vi
    .fn()
    .mockResolvedValueOnce({ jobs: [job('lead', 'examine', null, 'Finding items')] })
    .mockResolvedValueOnce({
      jobs: [
        job('lead', 'examine', null, 'Grouping the reel photos'),
        job('r1', 'research', 'l1', 'Checking the datasheet', '2026-11-06T10:02:00.000Z'),
        job('i1', 'images', 'l1', 'Choosing a photo', '2026-11-06T10:01:00.000Z'),
      ],
    })
  const client = { read, session: vi.fn() } as unknown as ProcessingClient
  const { result, rerender } = renderHook(
    ({ revision }) => useSessionStatuses(client, 'b', revision),
    { initialProps: { revision: '4' }, wrapper },
  )
  await waitFor(() => expect(result.current.lead).toBe('Finding items'))
  expect(result.current.leadRunning).toBe(true)
  expect(result.current.lots.size).toBe(0)
  rerender({ revision: '5' })
  await waitFor(() => expect(result.current.lead).toBe('Grouping the reel photos'))
  expect(result.current.lots.get('l1')).toBe('Research · Checking the datasheet')
  expect(client.session).not.toHaveBeenCalled()
})

it('reads nothing where sessions are not supported', () => {
  const read = vi.fn()
  const { result } = renderHook(
    () => useSessionStatuses({ read } as unknown as ProcessingClient, 'b', '1'),
    { wrapper },
  )
  expect(result.current).toEqual({ lead: undefined, leadRunning: false, lots: new Map() })
  expect(read).not.toHaveBeenCalled()
})

it('leaves out the last line of a session that has finished or ended', async () => {
  const ended = (id: string, state: string) => ({
    ...job(id, 'research', id, 'Old line', '2026-11-06T10:00:00.000Z'),
    session_state: state,
  })

  const read = vi.fn().mockResolvedValue({
    jobs: [
      ended('l1', 'finished'),
      ended('l2', 'cancelled'),
      job('l3', 'images', 'l3', 'Now', 'x'),
    ],
  })
  const client = { read, session: vi.fn() } as unknown as ProcessingClient
  const { result } = renderHook(() => useSessionStatuses(client, 'b', '1'), { wrapper })
  await waitFor(() => expect(result.current.lots.size).toBe(1))
  expect(result.current.lots.get('l3')).toBe('Images · Now')
})

it('drops its statuses when a later read fails, so Capture stops claiming sorting', async () => {
  const read = vi
    .fn()
    .mockResolvedValueOnce({ jobs: [job('lead', 'examine', null, 'Sorting reels')] })
    .mockRejectedValueOnce(new Error('offline'))
  const client = { read, session: vi.fn() } as unknown as ProcessingClient
  const { result, rerender } = renderHook(
    ({ revision }) => useSessionStatuses(client, 'b', revision),
    { initialProps: { revision: '1' }, wrapper },
  )
  await waitFor(() => expect(result.current.leadRunning).toBe(true))
  rerender({ revision: '2' })
  await waitFor(() => expect(result.current.leadRunning).toBe(false))
  expect(result.current.lead).toBeUndefined()
})

it('re-reads on its interval, since status lines move without a capture change', async () => {
  vi.useFakeTimers({ shouldAdvanceTime: true })
  try {
    const read = vi
      .fn()
      .mockResolvedValueOnce({ jobs: [job('lead', 'examine', null, 'Finding items')] })
      .mockResolvedValue({ jobs: [job('lead', 'examine', null, 'Grouping reels')] })
    const client = { read, session: vi.fn() } as unknown as ProcessingClient
    const { result } = renderHook(() => useSessionStatuses(client, 'b', '1'), { wrapper })
    await waitFor(() => expect(result.current.lead).toBe('Finding items'))
    await vi.advanceTimersByTimeAsync(SESSION_STATUS_REFRESH_MS)
    await waitFor(() => expect(result.current.lead).toBe('Grouping reels'))
  } finally {
    vi.useRealTimers()
  }
})

it('after a failed read, a new revision does not bring back the old lines while it loads', async () => {
  vi.useFakeTimers({ shouldAdvanceTime: true })
  try {
    let finish: (value: unknown) => void = () => undefined

    const read = vi
      .fn()
      .mockResolvedValueOnce({ jobs: [job('lead', 'examine', null, 'Sorting reels')] })
      .mockRejectedValueOnce(new Error('offline'))
      .mockImplementationOnce(() => new Promise((resolve) => (finish = resolve)))
    const client = { read, session: vi.fn() } as unknown as ProcessingClient
    const { result, rerender } = renderHook(
      ({ revision }) => useSessionStatuses(client, 'b', revision),
      { initialProps: { revision: '1' }, wrapper },
    )
    await waitFor(() => expect(result.current.lead).toBe('Sorting reels'))
    await vi.advanceTimersByTimeAsync(SESSION_STATUS_REFRESH_MS)
    await waitFor(() => expect(result.current.lead).toBeUndefined())
    rerender({ revision: '2' })
    await vi.advanceTimersByTimeAsync(10)
    expect(read).toHaveBeenCalledTimes(3)
    expect(result.current.lead).toBeUndefined()
    finish({ jobs: [job('lead', 'examine', null, 'Done sorting')] })
    await waitFor(() => expect(result.current.lead).toBe('Done sorting'))
  } finally {
    vi.useRealTimers()
  }
})
