import { renderHook, waitFor } from '@testing-library/react'
import { expect, it, vi } from 'vitest'
import { useLeadStatus } from './lead-status'
import type { ProcessingClient } from './types'

it('reads the lead session’s latest status line and re-reads when the revision moves', async () => {
  const read = vi.fn().mockResolvedValue({ jobs: [{ id: 'lead', stage: 'examine' }] })
  const session = vi
    .fn()
    .mockResolvedValueOnce({ outbox: [{ kind: 'status', payload: { text: 'Finding items' } }] })
    .mockResolvedValueOnce({
      outbox: [
        { kind: 'status', payload: { text: 'Finding items' } },
        { kind: 'lot', payload: { lot_id: 'l1' } },
        { kind: 'status', payload: { text: 'Grouping the reel photos' } },
      ],
    })
  const client = { read, session } as unknown as ProcessingClient
  const { result, rerender } = renderHook(({ revision }) => useLeadStatus(client, 'b', revision), {
    initialProps: { revision: '4' },
  })
  await waitFor(() => expect(result.current).toBe('Finding items'))
  rerender({ revision: '5' })
  await waitFor(() => expect(result.current).toBe('Grouping the reel photos'))
  expect(session).toHaveBeenCalledWith('b', 'lead')
})
