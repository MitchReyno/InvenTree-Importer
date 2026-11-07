import { renderHook, waitFor } from '@testing-library/react'
import { expect, it, vi } from 'vitest'
import { useSessionStatuses } from './session-status'
import type { ProcessingClient } from './types'

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
    { initialProps: { revision: '4' } },
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
  const { result } = renderHook(() =>
    useSessionStatuses({ read } as unknown as ProcessingClient, 'b', '1'),
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
  const { result } = renderHook(() => useSessionStatuses(client, 'b', '1'))
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
    { initialProps: { revision: '1' } },
  )
  await waitFor(() => expect(result.current.leadRunning).toBe(true))
  rerender({ revision: '2' })
  await waitFor(() => expect(result.current.leadRunning).toBe(false))
  expect(result.current.lead).toBeUndefined()
})
