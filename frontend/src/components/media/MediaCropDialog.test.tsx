import { render, screen } from '@testing-library/react'
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
  const save = vi.fn(async (_input: MediaEditDto, _key: string) => {
    throw new Error('lost ack')
  })
  const props = {
    batchId: snapshot.batch_id,
    version,
    pageNumber: 1,
    revision: '5',
    snapshot,
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
  const save = vi.fn(async (_input: MediaEditDto, _key: string) => undefined)
  const props = {
    batchId: snapshot.batch_id,
    version,
    pageNumber: 1,
    revision: '5',
    snapshot,
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
