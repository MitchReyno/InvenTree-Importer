import { act, renderHook, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { expect, test, vi } from 'vitest'
import type { MediaSnapshotDto } from '@invimport/contracts'
import { ServerStateProvider } from '#/components/query/ServerStateProvider'
import { fixtureScope } from '#/test/render'
import type { MediaClient } from './types'
import { useEvidenceWorkspace } from './useEvidenceWorkspace'

const batchId = '10000000-0000-4000-8000-000000000001'
const front = '60000000-0000-4000-8000-000000000006'
const back = '70000000-0000-4000-8000-000000000007'

function snapshot(revision: string): MediaSnapshotDto {
  return {
    batch_id: batchId,
    revision,
    groups: [],
    evidence: [
      { id: front, label: 'Front label', group_id: null, linked_subject_ids: [], versions: [] },
      { id: back, label: 'Back marking', group_id: null, linked_subject_ids: [], versions: [] },
    ],
    attachments: [],
    derivations: [],
  }
}

function client(): MediaClient {
  return {
    snapshot: vi.fn(async () => snapshot('4')),
    removalImpact: vi.fn(),
    edit: vi.fn(async () => snapshot('5')),
    upload: vi.fn(),
  }
}

function wrapper({ children }: { children: ReactNode }) {
  return <ServerStateProvider scope={fixtureScope}>{children}</ServerStateProvider>
}

async function mount(media: MediaClient) {
  const view = renderHook(() => useEvidenceWorkspace(batchId, media, false, vi.fn()), { wrapper })
  await waitFor(() => expect(view.result.current.snapshot?.revision).toBe('4'))
  return view
}

test('a change refused because another change is unconfirmed is not reported as unconfirmed', async () => {
  const media = client()
  vi.mocked(media.edit).mockRejectedValueOnce(new Error('lost'))
  const { result } = await mount(media)

  let first: string | undefined
  await act(async () => {
    first = await result.current.send({ kind: 'ungroup', group_id: front })
  })
  expect(first).toBe('unconfirmed')
  let second: string | undefined
  await act(async () => {
    second = await result.current.send({ kind: 'remove', evidence_ids: [back] })
  })

  expect(second).toBe('not_sent')
  expect(media.edit).toHaveBeenCalledOnce()
})

test('a selection taken at another revision keeps it after a confirmed delete', async () => {
  const media = client()
  const { result } = await mount(media)
  act(() => result.current.select([back], '3'))

  await act(async () => {
    await result.current.send({ kind: 'remove', evidence_ids: [front] })
  })
  expect(result.current.selected).toEqual([back])
  await act(async () => {
    await result.current.move([back], front)
  })

  expect(vi.mocked(media.edit).mock.calls[1][1]).toMatchObject({ expected_revision: '3' })
})
