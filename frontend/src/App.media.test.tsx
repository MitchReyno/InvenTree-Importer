import { screen } from '@testing-library/react'
import { afterEach, expect, test, vi } from 'vitest'
import type { CaptureSnapshotDto, MediaSnapshotDto } from '@invimport/contracts'
import App from './App'
import { render } from './test/render'

const batch: CaptureSnapshotDto = {
  id: '10000000-0000-4000-8000-000000000001',
  source_id: '20000000-0000-4000-8000-000000000002',
  actor_id: '30000000-0000-4000-8000-000000000003',
  target_context_id: '40000000-0000-4000-8000-000000000004',
  title: 'Explicit media startup',
  revision: '1',
  updated_at: '2026-11-02T00:00:00Z',
  archived: false,
  defaults: { quantity: { mode: 'unknown' }, location: { mode: 'clear' } },
  lots: [],
  parts: [],
  notes: [],
  observations: [],
  cursor: { stream_id: '50000000-0000-4000-8000-000000000005', sequence: '0' },
}
const media: MediaSnapshotDto = {
  batch_id: batch.id,
  revision: '1',
  evidence: [],
  attachments: [],
  groups: [],
  derivations: [],
}

function json(value: unknown) {
  return new Response(JSON.stringify(value), {
    headers: { 'content-type': 'application/json' },
  })
}

afterEach(() => {
  vi.restoreAllMocks()
  history.replaceState(null, '', location.pathname)
})

test.each([true, false, undefined])(
  'media requests require an explicit enabled bootstrap flag: %s',
  async (enabled) => {
    location.hash = batch.id
    const mediaReads = vi.fn()
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const path = new URL(String(input)).pathname
      if (path.endsWith('/bootstrap')) {
        return json({
          mode: 'development-key',
          banner: 'Single-operator development mode — not a verified human session',
          status: 'configured',
          actor_id: batch.actor_id,
          target_id: '60000000-0000-4000-8000-000000000006',
          target_context_id: batch.target_context_id,
          mutation_enabled: false,
          media_enabled: enabled,
          permission_gate: 'deferred_T11',
          csrf_token: 'a'.repeat(64),
        })
      }
      if (path.endsWith('/activity')) {
        return json({ runs: [], truncated: false })
      }
      if (path.endsWith('/media')) {
        mediaReads()
        return json(media)
      }
      return json(batch)
    })
    render(<App />)
    await screen.findByRole('heading', { name: batch.title })
    if (enabled) {
      expect(await screen.findByLabelText('Add a photo or PDF')).toBeEnabled()
      expect(mediaReads).toHaveBeenCalledTimes(1)
    } else {
      expect(screen.queryByLabelText('Add a photo or PDF')).not.toBeInTheDocument()
      expect(mediaReads).not.toHaveBeenCalled()
    }
  },
)
