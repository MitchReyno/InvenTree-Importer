import { render } from '#/test/render'
import { fireEvent, screen, waitFor } from '@testing-library/react'
import { useState } from 'react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import type { MediaEditDto, MediaSnapshotDto, MediaVersionDto } from '@invimport/contracts'
import { MediaCropDialog } from './MediaCropDialog'

const version: MediaVersionDto = {
  id: '10000000-0000-4000-8000-000000000001',
  evidence_id: '20000000-0000-4000-8000-000000000002',
  kind: 'original',
  digest: 'a'.repeat(64),
  byte_size: '100',
  media_type: 'image/png',
  state: 'ready',
  decoder_build: 'fixture',
  recipe: null,
  pages: [{ page: 1, width: 80, height: 60, preview_id: '30000000-0000-4000-8000-000000000003' }],
}
const snapshot: MediaSnapshotDto = {
  batch_id: '40000000-0000-4000-8000-000000000004',
  revision: '5',
  evidence: [
    {
      id: version.evidence_id,
      label: 'fixture',
      group_id: null,
      linked_subject_ids: [],
      versions: [version],
    },
  ],
  attachments: [],
  groups: [],
  derivations: [],
}

beforeEach(() => {
  Object.defineProperty(HTMLDialogElement.prototype, 'showModal', {
    configurable: true,
    value: function (this: HTMLDialogElement) {
      this.open = true
    },
  })
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}

      disconnect() {}

      unobserve() {}
    },
  )
})

afterEach(() => vi.unstubAllGlobals())

test('uncertain crop ACK locks editing and retries exact key, ID, recipe and original revision across polling', async () => {
  const user = userEvent.setup()
  const save = vi.fn<(input: MediaEditDto, key: string) => Promise<void>>(async () => {
    throw new Error('lost ack')
  })
  const props = {
    batchId: snapshot.batch_id,
    version,
    pageNumber: 1,
    revision: '5',
    snapshot,
    readUnavailable: false,
    save,
    close: vi.fn(),
    onDirtyChange: vi.fn(),
  }
  const view = render(<MediaCropDialog {...props} />)
  await user.click(screen.getByRole('button', { name: 'Prepare new version' }))
  expect(save).toHaveBeenCalledTimes(1)
  const original = save.mock.calls[0]
  expect(original[0].expected_revision).toBe('5')
  expect(original[0].change.kind).toBe('derive')
  expect(screen.getByRole('spinbutton', { name: 'Width' })).toBeDisabled()
  view.rerender(
    <MediaCropDialog {...props} revision="9" snapshot={{ ...snapshot, revision: '9' }} />,
  )
  await user.click(screen.getByRole('button', { name: 'Retry exact preparation request' }))
  expect(save.mock.calls[1]).toEqual(original)
  expect(
    screen.queryByAltText('Retained output for this exact rotated crop'),
  ).not.toBeInTheDocument()
})

test('prepared output is shown only for this submitted derivation ID and exact recipe', async () => {
  const user = userEvent.setup()
  const save = vi.fn<(input: MediaEditDto, key: string) => Promise<void>>(async () => undefined)
  const props = {
    batchId: snapshot.batch_id,
    version,
    pageNumber: 1,
    revision: '5',
    snapshot,
    readUnavailable: false,
    save,
    close: vi.fn(),
    onDirtyChange: vi.fn(),
  }
  const view = render(<MediaCropDialog {...props} />)
  await user.click(screen.getByRole('button', { name: 'Prepare new version' }))
  const change = save.mock.calls[0][0].change
  if (change.kind !== 'derive' || !change.derivation_id) {
    throw new Error('expected exact derivation request')
  }
  const output: MediaVersionDto = {
    ...version,
    id: '50000000-0000-4000-8000-000000000005',
    kind: 'derived',
    recipe: change.recipe,
    pages: [{ page: 1, width: 48, height: 36, preview_id: '60000000-0000-4000-8000-000000000006' }],
  }
  const prepared: MediaSnapshotDto = {
    ...snapshot,
    evidence: [{ ...snapshot.evidence[0], versions: [version, output] }],
    derivations: [
      {
        id: '70000000-0000-4000-8000-000000000007',
        evidence_id: version.evidence_id,
        recipe: change.recipe,
        state: 'ready',
        version_id: output.id,
      },
    ],
  }
  view.rerender(<MediaCropDialog {...props} snapshot={prepared} />)
  expect(
    screen.queryByAltText('Retained output for this exact rotated crop'),
  ).not.toBeInTheDocument()
  prepared.derivations[0].id = change.derivation_id
  view.rerender(<MediaCropDialog {...props} snapshot={{ ...prepared }} />)
  expect(screen.getByAltText('Retained output for this exact rotated crop')).toHaveAttribute(
    'src',
    expect.stringContaining(output.pages[0].preview_id),
  )
  const mismatch = { ...change.recipe, source_digest: 'b'.repeat(64) }
  view.rerender(
    <MediaCropDialog
      {...props}
      snapshot={{ ...prepared, derivations: [{ ...prepared.derivations[0], recipe: mismatch }] }}
    />,
  )
  expect(
    screen.queryByAltText('Retained output for this exact rotated crop'),
  ).not.toBeInTheDocument()
  expect(screen.getByRole('alert')).toHaveTextContent('does not match')
})

test('explicit new crop captures the current read revision with a new identity after a successful preparation', async () => {
  const user = userEvent.setup()
  const save = vi.fn<(input: MediaEditDto, key: string) => Promise<void>>(async () => undefined)
  const props = {
    batchId: snapshot.batch_id,
    version,
    pageNumber: 1,
    revision: '5',
    snapshot,
    readUnavailable: false,
    save,
    close: vi.fn(),
    onDirtyChange: vi.fn(),
  }
  const view = render(<MediaCropDialog {...props} />)
  await user.click(screen.getByRole('button', { name: 'Prepare new version' }))
  const first = save.mock.calls[0]
  view.rerender(<MediaCropDialog {...props} snapshot={{ ...snapshot, revision: '9' }} />)
  await user.click(screen.getByRole('button', { name: 'Edit another crop' }))
  await user.click(screen.getByRole('button', { name: 'Prepare new version' }))
  expect(save.mock.calls[1][0].expected_revision).toBe('9')
  expect(save.mock.calls[1][1]).not.toBe(first[1])
  const earlier = first[0].change
  const later = save.mock.calls[1][0].change
  if (earlier.kind !== 'derive' || later.kind !== 'derive') {
    throw new Error('expected derivation commands')
  }
  expect(later.derivation_id).not.toBe(earlier.derivation_id)
  expect(first[0].expected_revision).toBe('5')
})

test('crop modal stays accessible when its Capture context becomes hidden at a narrow viewport', () => {
  render(
    <div hidden>
      <MediaCropDialog
        batchId={snapshot.batch_id}
        version={version}
        pageNumber={1}
        revision="5"
        snapshot={snapshot}
        readUnavailable={false}
        save={vi.fn(async () => undefined)}
        close={vi.fn()}
        onDirtyChange={vi.fn()}
      />
    </div>,
  )
  const dialog = screen.getByRole('dialog', { name: 'Prepare documentary crop' })
  expect(dialog.parentElement).toBe(document.body)
  expect(screen.getByRole('button', { name: 'Prepare new version' })).toBeEnabled()
})

interface CropDialogHarnessProps {
  save: (input: MediaEditDto, key: string) => Promise<void>
}

function CropDialogHarness({ save }: CropDialogHarnessProps) {
  const [editing, setEditing] = useState(true)
  const [dirty, setDirty] = useState(false)

  return (
    <>
      <button disabled={dirty} onClick={() => setEditing(true)}>
        Open crop editor
      </button>
      <output>{dirty ? 'Crop guard active' : 'Crop guard released'}</output>
      {editing && (
        <MediaCropDialog
          batchId={snapshot.batch_id}
          version={version}
          pageNumber={1}
          revision="5"
          snapshot={snapshot}
          readUnavailable={false}
          save={save}
          close={() => setEditing(false)}
          onDirtyChange={setDirty}
        />
      )}
    </>
  )
}

function forceNativeClose(dialog: HTMLDialogElement) {
  fireEvent(dialog, new Event('cancel', { cancelable: false }))
  dialog.open = false
  fireEvent(dialog, new Event('close'))
}

test('forced native dismissal discards an unsent draft, releases its guard and permits reopening', async () => {
  const user = userEvent.setup()
  const save = vi.fn<(input: MediaEditDto, key: string) => Promise<void>>()
  render(<CropDialogHarness save={save} />)
  const dialog = screen.getByRole<HTMLDialogElement>('dialog', {
    name: 'Prepare documentary crop',
  })
  const firstCancel = new Event('cancel', { cancelable: true })
  fireEvent(dialog, firstCancel)
  expect(firstCancel.defaultPrevented).toBe(true)
  expect(dialog.open).toBe(true)

  forceNativeClose(dialog)

  expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  expect(screen.getByText('Crop guard released')).toBeVisible()
  expect(save).not.toHaveBeenCalled()
  await user.click(screen.getByRole('button', { name: 'Open crop editor' }))
  expect(screen.getByRole('dialog', { name: 'Prepare documentary crop' })).toBeVisible()
})

test('forced native dismissal after confirmed preparation closes the view and clears the parent guard', async () => {
  const user = userEvent.setup()
  const save = vi.fn<(input: MediaEditDto, key: string) => Promise<void>>(async () => undefined)
  render(<CropDialogHarness save={save} />)
  await user.click(screen.getByRole('button', { name: 'Prepare new version' }))
  expect(screen.getByRole('button', { name: 'Close prepared crop' })).toBeEnabled()

  forceNativeClose(screen.getByRole<HTMLDialogElement>('dialog'))

  expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  expect(screen.getByText('Crop guard released')).toBeVisible()
  expect(save).toHaveBeenCalledTimes(1)
})

test('forced close preserves a pending request, its uncertain retry and explicit discard', async () => {
  const user = userEvent.setup()

  let rejectPending: (error: Error) => void = () => {
    throw new Error('request was not started')
  }

  const save = vi.fn<(input: MediaEditDto, key: string) => Promise<void>>()
  save.mockImplementationOnce(
    () =>
      new Promise<void>((_resolve, reject) => {
        rejectPending = reject
      }),
  )
  save.mockRejectedValue(new Error('lost acknowledgement'))
  render(<CropDialogHarness save={save} />)
  await user.click(screen.getByRole('button', { name: 'Prepare new version' }))
  const original = save.mock.calls[0]
  const dialog = screen.getByRole<HTMLDialogElement>('dialog')

  forceNativeClose(dialog)

  expect(dialog.open).toBe(true)
  expect(screen.getByText('Crop guard active')).toBeVisible()
  expect(screen.getByRole('button', { name: 'Discard and close' })).toBeDisabled()
  expect(save).toHaveBeenCalledTimes(1)

  rejectPending(new Error('lost acknowledgement'))
  await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('not confirmed'))
  forceNativeClose(dialog)
  expect(dialog.open).toBe(true)
  expect(screen.getByRole('spinbutton', { name: 'Width' })).toBeDisabled()
  await user.click(screen.getByRole('button', { name: 'Retry exact preparation request' }))
  expect(save.mock.calls[1]).toEqual(original)
  expect(save).toHaveBeenCalledTimes(2)

  await user.click(screen.getByRole('button', { name: 'Discard and close' }))
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  expect(screen.getByText('Crop guard released')).toBeVisible()
})

test('failed native modal restoration leaves the uncertain request and recovery controls visible', async () => {
  const user = userEvent.setup()
  const save = vi.fn<(input: MediaEditDto, key: string) => Promise<void>>(async () => {
    throw new Error('lost acknowledgement')
  })
  render(<CropDialogHarness save={save} />)
  await user.click(screen.getByRole('button', { name: 'Prepare new version' }))
  const original = save.mock.calls[0]
  const dialog = screen.getByRole<HTMLDialogElement>('dialog')
  vi.spyOn(dialog, 'showModal').mockImplementationOnce(() => {
    throw new DOMException('modal unavailable', 'InvalidStateError')
  })

  forceNativeClose(dialog)

  expect(dialog.open).toBe(true)
  expect(screen.getByRole('alert')).toHaveTextContent('modal view')
  expect(screen.getByRole('button', { name: 'Retry exact preparation request' })).toBeVisible()
  expect(screen.getByText('Crop guard active')).toBeVisible()
  await user.click(screen.getByRole('button', { name: 'Retry exact preparation request' }))
  expect(save.mock.calls[1]).toEqual(original)
  await user.click(screen.getByRole('button', { name: 'Discard and close' }))
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  expect(screen.getByText('Crop guard released')).toBeVisible()
})
