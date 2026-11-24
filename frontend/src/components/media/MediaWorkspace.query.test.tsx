import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { expect, test, vi } from 'vitest'
import { setDebugMode } from '#/test/debug-mode'
import type { CaptureSnapshotDto, MediaSnapshotDto } from '@invimport/contracts'
import { ServerStateProvider } from '#/components/query/ServerStateProvider'
import { createServerQueryClient } from '#/queries/client'
import { serverQueryKey } from '#/queries/scope'
import { fixtureScope } from '#/test/render'
import type { MediaClient } from '#/media/types'
import { MediaWorkspace } from './MediaWorkspace'
import { mediaIdentityLabels } from '#/media/identity-labels'
import { listedOptions, pickOption, pickerText } from '#/test/picker'
import { trackDialogOpeners } from '#/components/ui'

const batch: CaptureSnapshotDto = {
  id: '10000000-0000-4000-8000-000000000001',
  source_id: '20000000-0000-4000-8000-000000000002',
  actor_id: fixtureScope.actorId,
  target_context_id: fixtureScope.targetContextId,
  title: 'Scoped retained media',
  revision: '1',
  archived: false,
  updated_at: '2026-11-02T00:00:00Z',
  defaults: { quantity: { mode: 'unknown' }, location: { mode: 'clear' } },
  lots: [],
  parts: [],
  notes: [],
  observations: [],
  cursor: { stream_id: '30000000-0000-4000-8000-000000000003', sequence: '0' },
}
const snapshot: MediaSnapshotDto = {
  batch_id: batch.id,
  revision: '1',
  evidence: [],
  groups: [],
  attachments: [],
  derivations: [],
}

function client(read: MediaClient['snapshot']): MediaClient {
  return {
    removalImpact: vi.fn(),
    snapshot: read,
    edit: vi.fn(async () => snapshot),
    upload: vi.fn(async () => {
      throw new Error('lost acknowledgment')
    }),
  }
}

test('warm cache cannot authorize media input before this mount obtains a successful fresh read', async () => {
  const queries = createServerQueryClient()
  const key = serverQueryKey(fixtureScope, 'media', batch.id)
  queries.setQueryData(key, snapshot)

  let rejectRead: (reason: Error) => void = () => {
    throw new Error('read not started')
  }

  const media = client(
    vi.fn(
      () =>
        new Promise<MediaSnapshotDto>((_resolve, reject) => {
          rejectRead = reject
        }),
    ),
  )
  render(
    <ServerStateProvider scope={fixtureScope} client={queries}>
      <MediaWorkspace
        batch={batch}
        client={media}
        disabled={false}
        selectedSubject="defaults"
        onDirtyChange={vi.fn()}
      />
    </ServerStateProvider>,
  )
  expect(screen.getByLabelText('Choose photos')).toBeDisabled()
  await act(async () => rejectRead(new Error('offline')))
  await screen.findByRole('alert')
  expect(screen.getByLabelText('Choose photos')).toBeDisabled()
  expect(media.upload).not.toHaveBeenCalled()
  expect(media.edit).not.toHaveBeenCalled()
  vi.mocked(media.snapshot).mockResolvedValue(snapshot)
  await userEvent.setup().click(screen.getByRole('button', { name: 'Refresh saved evidence' }))
  await waitFor(() => expect(screen.getByLabelText('Choose photos')).toBeEnabled())
})

test('failed retained polling preserves an unconfirmed upload and its exact request through recovery', async () => {
  const queries = createServerQueryClient()
  const key = serverQueryKey(fixtureScope, 'media', batch.id)
  const media = client(vi.fn(async () => snapshot))
  const user = userEvent.setup()
  render(
    <ServerStateProvider scope={fixtureScope} client={queries}>
      <MediaWorkspace
        batch={batch}
        client={media}
        disabled={false}
        selectedSubject="defaults"
        onDirtyChange={vi.fn()}
      />
    </ServerStateProvider>,
  )
  const input = await screen.findByLabelText('Choose photos')
  await waitFor(() => expect(input).toBeEnabled())
  const file = new File(['source bytes'], 'retained.png', { type: 'image/png' })
  await user.upload(input, file)
  await waitFor(() => expect(media.upload).toHaveBeenCalledTimes(1))
  const retry = await screen.findByRole('button', { name: 'Retry retained.png' })
  const original = vi.mocked(media.upload).mock.calls[0]
  vi.mocked(media.snapshot).mockRejectedValue(new Error('offline'))
  await act(async () => {
    await queries.refetchQueries({ queryKey: key })
  })
  await waitFor(() => expect(retry).toBeDisabled())
  vi.mocked(media.snapshot).mockResolvedValue({ ...snapshot, revision: '8' })
  await user.click(screen.getByRole('button', { name: 'Refresh saved evidence' }))
  await waitFor(() => expect(retry).toBeEnabled())
  await user.click(retry)
  await waitFor(() => expect(media.upload).toHaveBeenCalledTimes(2))
  expect(vi.mocked(media.upload).mock.calls[1]).toEqual(original)
  expect(original[1]).toBe('1')
  expect(original[3]).toBe(file)
})

test('attachment options distinguish colliding identities and match visible retained version labels', async () => {
  const lotId = '90000000-0000-4000-8000-000000000009'
  const populated: MediaSnapshotDto = {
    ...snapshot,
    evidence: ['11111111-1000-4000-8000-000000000001', '11111111-2000-4000-8000-000000000002'].map(
      (id, evidenceIndex) => ({
        id,
        label: 'photo.png',
        group_id: null,
        linked_subject_ids: [],
        versions: [1, 2].map((versionIndex) => ({
          id: `22222222-${evidenceIndex}${versionIndex}00-4000-8000-000000000001`,
          evidence_id: id,
          kind: 'derived' as const,
          digest: 'a'.repeat(64),
          byte_size: '123',
          media_type: 'image/png' as const,
          state: 'ready' as const,
          decoder_build: 'fixture/1',
          recipe: null,
          pages: [
            {
              page: 1,
              width: 48,
              height: 36,
              preview_id: `33333333-${evidenceIndex}${versionIndex}00-4000-8000-000000000001`,
            },
          ],
        })),
      }),
    ),
  }
  const selectedVersion = populated.evidence[1].versions[1]
  populated.attachments = [
    {
      id: '70000000-0000-4000-8000-000000000007',
      subject_id: lotId,
      mode: 'selected',
      version_id: selectedVersion.id,
      destination: 'lot_attachment',
    },
  ]
  const media = client(vi.fn(async () => populated))
  const populatedBatch: CaptureSnapshotDto = {
    ...batch,
    lots: [
      {
        id: lotId,
        label: 'Chosen lot',
        revision: '1',
        contribution_key: '80000000-0000-4000-8000-000000000008',
        part_subject_id: null,
        quantity: { mode: 'unknown' },
        location: { mode: 'clear' },
      },
    ],
  }
  render(
    <ServerStateProvider scope={fixtureScope} client={createServerQueryClient()}>
      <MediaWorkspace
        batch={populatedBatch}
        client={media}
        disabled={false}
        selectedSubject={lotId}
        onDirtyChange={vi.fn()}
      />
    </ServerStateProvider>,
  )
  const name = 'Attachment for Chosen lot'
  const choice = await screen.findByRole('combobox', { name })
  await waitFor(() => expect(choice).toBeEnabled())
  const versionIds = populated.evidence.flatMap((evidence) =>
    evidence.versions.map((version) => version.id),
  )
  const labels = mediaIdentityLabels(populated.evidence).versions
  const user = userEvent.setup()
  await user.click(choice)
  const options = listedOptions().slice(2)
  await user.keyboard('{Escape}')
  expect(options).toHaveLength(4)
  expect(new Set(options).size).toBe(4)
  expect(options).toEqual(versionIds.map((id) => labels.get(id)))
  for (const [position, label] of options.entries()) {
    // Each file opens by its numbered name; its viewer shows the same exact version identity.
    const index = populated.evidence.findIndex((evidence) =>
      evidence.versions.some((version) => version.id === versionIds[position]),
    )
    const fileName = `photo.png (${index + 1})`
    await user.click(screen.getByRole('button', { name: `Open ${fileName}` }))
    const viewer = screen.getByRole('dialog', { name: fileName })
    const visibleVersion = within(viewer).getAllByText(
      (text, element) => element?.tagName === 'SMALL' && text.startsWith(`${label} · ready`),
    )
    expect(visibleVersion).toHaveLength(1)
    await user.click(within(viewer).getByRole('button', { name: 'Close' }))
    expect(label).toContain('photo.png · evidence 11111111')
    expect(label).toContain(' · crop 22222222')
  }
  const selectedLabel = labels.get(selectedVersion.id)
  expect(pickerText(name)).toBe(selectedLabel)
  expect(choice).toHaveAccessibleDescription(`Selected attachment: ${selectedLabel}`)
  expect(screen.getByText(`Selected attachment: ${selectedLabel}`)).toBeVisible()

  const replacementVersion = populated.evidence[0].versions[0]
  await pickOption(user, name, labels.get(replacementVersion.id)!)
  expect(media.edit).toHaveBeenCalledWith(
    populatedBatch.id,
    {
      expected_revision: populated.revision,
      change: {
        kind: 'select_attachment',
        subject_id: lotId,
        mode: 'selected',
        version_id: replacementVersion.id,
        destination: 'lot_attachment',
      },
    },
    expect.any(String),
  )
})

test('a tile shows the file and its lots; crop, download and byte identity live in its viewer', async () => {
  const evidenceId = '44444444-0000-4000-8000-000000000004'
  const version = {
    id: '55555555-0000-4000-8000-000000000005',
    evidence_id: evidenceId,
    kind: 'original' as const,
    digest: 'b'.repeat(64),
    byte_size: '2048',
    media_type: 'image/jpeg' as const,
    state: 'ready' as const,
    decoder_build: 'fixture/1',
    recipe: null,
    pages: [
      { page: 1, width: 1200, height: 900, preview_id: '66666666-0000-4000-8000-000000000006' },
    ],
  }
  const withFile: MediaSnapshotDto = {
    ...snapshot,
    evidence: [
      {
        id: evidenceId,
        label: 'Packet front',
        group_id: null,
        linked_subject_ids: [],
        versions: [version],
      },
    ],
  }
  const user = userEvent.setup()
  render(
    <ServerStateProvider scope={fixtureScope} client={createServerQueryClient()}>
      <MediaWorkspace
        batch={batch}
        client={client(vi.fn(async () => withFile))}
        disabled={false}
        selectedSubject="defaults"
        onDirtyChange={vi.fn()}
      />
    </ServerStateProvider>,
  )

  const open = await screen.findByRole('button', { name: 'Open Packet front' })
  expect(open.querySelector('img')).toHaveAttribute(
    'src',
    expect.stringContaining('66666666-0000-4000-8000-000000000006'),
  )
  expect(screen.getByText('0 lots')).toBeInTheDocument()
  // No digest, byte size or crop control inline on Capture.
  expect(screen.queryByText(/bbbbbbbb/)).not.toBeInTheDocument()
  expect(screen.queryByRole('button', { name: 'Prepare crop / rotation' })).not.toBeInTheDocument()

  await user.click(open)
  const viewer = screen.getByRole('dialog', { name: 'Packet front' })
  expect(
    within(viewer).getByRole('button', { name: 'Prepare crop / rotation' }),
  ).toBeInTheDocument()
  expect(within(viewer).getByRole('link', { name: 'Download retained original' })).toHaveAttribute(
    'href',
    expect.stringContaining(version.id),
  )
  // Byte identity is internal: it shows in the viewer only in debug mode.
  expect(
    within(viewer).queryByRole('group', { name: 'Debug: Retained byte identity' }),
  ).not.toBeInTheDocument()
  setDebugMode(true)
  expect(
    within(viewer).getByRole('group', { name: 'Debug: Retained byte identity' }),
  ).toHaveTextContent(version.digest)
  setDebugMode(false)
})

test('a crop editor opened by a click that left focus elsewhere returns focus to its button', async () => {
  const evidenceId = '44444444-0000-4000-8000-000000000004'
  const version = {
    id: '55555555-0000-4000-8000-000000000005',
    evidence_id: evidenceId,
    kind: 'original' as const,
    digest: 'b'.repeat(64),
    byte_size: '2048',
    media_type: 'image/jpeg' as const,
    state: 'ready' as const,
    decoder_build: 'fixture/1',
    recipe: null,
    pages: [
      { page: 1, width: 1200, height: 900, preview_id: '66666666-0000-4000-8000-000000000006' },
    ],
  }
  const withFile: MediaSnapshotDto = {
    ...snapshot,
    evidence: [
      {
        id: evidenceId,
        label: 'Packet front',
        group_id: null,
        linked_subject_ids: [],
        versions: [version],
      },
    ],
  }
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}

      disconnect() {}

      unobserve() {}
    },
  )
  const stopTracking = trackDialogOpeners()
  try {
    const user = userEvent.setup()
    render(
      <ServerStateProvider scope={fixtureScope} client={createServerQueryClient()}>
        <MediaWorkspace
          batch={batch}
          client={client(vi.fn(async () => withFile))}
          disabled={false}
          selectedSubject="defaults"
          onDirtyChange={vi.fn()}
        />
      </ServerStateProvider>,
    )
    await user.click(await screen.findByRole('button', { name: 'Open Packet front' }))
    const viewer = screen.getByRole('dialog', { name: 'Packet front' })
    const cropButton = within(viewer).getByRole('button', { name: 'Prepare crop / rotation' })
    expect(cropButton).not.toHaveFocus()

    // As Safari does: the click opens the editor without focusing its button.
    fireEvent.click(cropButton)
    const editor = screen.getByRole('dialog', { name: 'Prepare documentary crop' })
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0))
    })
    await user.click(editor.previousElementSibling as HTMLElement)

    expect(screen.queryByRole('dialog', { name: 'Prepare documentary crop' })).toBeNull()
    expect(screen.getByRole('dialog', { name: 'Packet front' })).toBeInTheDocument()
    await waitFor(() => expect(cropButton).toHaveFocus())
  } finally {
    stopTracking()
    vi.unstubAllGlobals()
  }
})
