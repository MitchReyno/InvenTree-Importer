import { useEffect } from 'react'
import { useNavigationGuard } from '../../navigation/useNavigationGuard'
import { withEvidence } from '../../operator/evidence-location'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { expect, test } from 'vitest'
import type { MediaEvidenceDto, MediaVersionDto } from '@invimport/contracts'
import { EvidenceViewer } from './EvidenceViewer'
import { mediaDisplayLabels } from '../../media/identity-labels'

const original: MediaVersionDto = {
  id: '20000000-0000-4000-8000-000000000002',
  evidence_id: '10000000-0000-4000-8000-000000000001',
  kind: 'original',
  digest: 'a'.repeat(64),
  byte_size: '1024',
  media_type: 'application/pdf',
  state: 'ready',
  decoder_build: 'fixture',
  recipe: null,
  pages: [
    { page: 1, width: 900, height: 1200, preview_id: '30000000-0000-4000-8000-000000000003' },
    { page: 2, width: 900, height: 1200, preview_id: '40000000-0000-4000-8000-000000000004' },
  ],
}
const evidence: MediaEvidenceDto = {
  id: original.evidence_id,
  label: 'Packing slip',
  group_id: null,
  linked_subject_ids: [],
  versions: [original],
}

const replacement: MediaVersionDto = {
  ...original,
  id: '50000000-0000-4000-8000-000000000005',
  pages: [{ page: 1, width: 600, height: 800, preview_id: '60000000-0000-4000-8000-000000000006' }],
}

test('selects exact document pages, zooms and keeps that page when polling adds a version', async () => {
  const user = userEvent.setup()
  const { rerender } = render(<EvidenceViewer batchId="batch" evidence={[evidence]} />)
  await user.selectOptions(screen.getByLabelText('Document page'), '2')
  expect(screen.getByRole('img')).toHaveAttribute(
    'src',
    '/api/v1/batches/batch/media/previews/40000000-0000-4000-8000-000000000004',
  )
  await user.click(screen.getByRole('button', { name: 'Zoom in' }))
  expect(screen.getByText('150%')).toBeVisible()
  rerender(
    <EvidenceViewer
      batchId="batch"
      evidence={[{ ...evidence, versions: [replacement, original] }]}
    />,
  )
  expect(screen.getByLabelText('Evidence source and version')).toHaveValue(original.id)
  expect(screen.getByLabelText('Document page')).toHaveValue('2')
  expect(screen.getByText('150%')).toBeVisible()
  await user.selectOptions(screen.getByLabelText('Evidence source and version'), replacement.id)
  expect(screen.getByRole('img')).toHaveAttribute(
    'src',
    '/api/v1/batches/batch/media/previews/60000000-0000-4000-8000-000000000006',
  )
  expect(screen.getByText('100%')).toBeVisible()
})

test('never substitutes a removed version, page or preview identity', async () => {
  const user = userEvent.setup()
  const { rerender } = render(<EvidenceViewer batchId="batch" evidence={[evidence]} />)
  await user.selectOptions(screen.getByLabelText('Document page'), '2')
  rerender(<EvidenceViewer batchId="batch" evidence={[{ ...evidence, versions: [replacement] }]} />)
  expect(screen.queryByRole('img')).not.toBeInTheDocument()
  expect(screen.getByText(/no replacement has been substituted/)).toBeVisible()
  rerender(
    <EvidenceViewer
      batchId="batch"
      evidence={[{ ...evidence, versions: [{ ...original, pages: [original.pages[0]] }] }]}
    />,
  )
  expect(screen.queryByRole('img')).not.toBeInTheDocument()
  rerender(
    <EvidenceViewer
      batchId="batch"
      evidence={[
        {
          ...evidence,
          versions: [
            {
              ...original,
              pages: [{ ...original.pages[1], preview_id: replacement.pages[0].preview_id }],
            },
          ],
        },
      ]}
    />,
  )
  expect(screen.queryByRole('img')).not.toBeInTheDocument()
  await user.selectOptions(screen.getByLabelText('Document page'), '2')
  expect(screen.getByRole('img')).toHaveAttribute(
    'src',
    '/api/v1/batches/batch/media/previews/60000000-0000-4000-8000-000000000006',
  )
})

test('an empty source choice cannot replace the explicitly selected version', async () => {
  const user = userEvent.setup()
  render(
    <EvidenceViewer
      batchId="batch"
      evidence={[{ ...evidence, versions: [original, replacement] }]}
    />,
  )
  const source = screen.getByLabelText('Evidence source and version')
  await user.selectOptions(source, replacement.id)
  expect(screen.getByRole('option', { name: 'Choose retained evidence' })).toBeDisabled()
  fireEvent.change(source, { target: { value: '' } })
  expect(source).toHaveValue(replacement.id)
  expect(screen.getByRole('img')).toHaveAttribute(
    'src',
    '/api/v1/batches/batch/media/previews/60000000-0000-4000-8000-000000000006',
  )
})

test('reports unavailable snapshots and retries only the selected failed preview', async () => {
  const user = userEvent.setup()
  render(<EvidenceViewer batchId="batch" evidence={[evidence]} unavailable />)
  expect(screen.getByText(/last retained snapshot/)).toBeVisible()
  fireEvent.error(screen.getByRole('img'))
  expect(screen.getByRole('alert')).toHaveTextContent('could not be loaded')
  const source = screen.getByRole('img').getAttribute('src')
  await user.click(screen.getByRole('button', { name: 'Retry selected preview' }))
  expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  expect(screen.getByRole('img')).toHaveAttribute('src', source)
})

test('a new lot lifetime chooses its own evidence and resets zoom', async () => {
  const user = userEvent.setup()
  const { rerender } = render(<EvidenceViewer key="lot-a" batchId="batch" evidence={[evidence]} />)
  await user.click(screen.getByRole('button', { name: 'Zoom in' }))
  rerender(
    <EvidenceViewer
      key="lot-b"
      batchId="batch"
      evidence={[{ ...evidence, versions: [replacement] }]}
    />,
  )
  expect(screen.getByLabelText('Evidence source and version')).toHaveValue(replacement.id)
  expect(screen.getByText('100%')).toBeVisible()
})

test('exact source/version/page/preview link survives remount and refuses a changed preview', async () => {
  history.replaceState(null, '', '#batch/review/lots/lot?filter=warnings')
  const user = userEvent.setup()
  const view = render(<EvidenceViewer batchId="batch" lotId="lot" evidence={[evidence]} />)
  await user.selectOptions(screen.getByLabelText('Document page'), '2')
  const params = new URLSearchParams(location.hash.split('?')[1])
  expect(params.get('source')).toBe(evidence.id)
  expect(params.get('version')).toBe(original.id)
  expect(params.get('page')).toBe('2')
  expect(params.get('preview')).toBe(original.pages[1].preview_id)
  expect(params.get('filter')).toBe('warnings')
  view.unmount()
  const restored = render(<EvidenceViewer batchId="batch" lotId="lot" evidence={[evidence]} />)
  expect(screen.getByLabelText('Document page')).toHaveValue('2')
  expect(screen.getByRole('img')).toHaveAttribute(
    'src',
    expect.stringContaining(original.pages[1].preview_id),
  )
  restored.rerender(
    <EvidenceViewer
      batchId="batch"
      lotId="lot"
      evidence={[
        {
          ...evidence,
          versions: [
            {
              ...original,
              pages: [{ ...original.pages[1], preview_id: replacement.pages[0].preview_id }],
            },
          ],
        },
      ]}
    />,
  )
  expect(screen.queryByRole('img')).not.toBeInTheDocument()
  expect(screen.getByText(/no replacement has been substituted/)).toBeVisible()
  history.replaceState(null, '', '#')
})

test('partial or malformed evidence links cannot fall back to the first ready source', () => {
  history.replaceState(null, '', '#batch/review/lots/lot?source=untrusted')
  render(<EvidenceViewer batchId="batch" lotId="lot" evidence={[evidence]} />)
  expect(screen.queryByRole('img')).not.toBeInTheDocument()
  expect(screen.getByText(/link is incomplete or invalid/)).toBeVisible()
  history.replaceState(null, '', '#')
})

test('same-document same-lot navigation follows exact pages and refuses unavailable or malformed links', async () => {
  const path = '#batch/review/lots/lot'
  const first = {
    evidenceId: evidence.id,
    versionId: original.id,
    page: 1,
    previewId: original.pages[0].preview_id,
  }
  history.replaceState(null, '', withEvidence(path, first))
  render(<EvidenceViewer batchId="batch" lotId="lot" evidence={[evidence]} />)
  await act(async () => {
    location.hash = withEvidence(path, {
      ...first,
      page: 2,
      previewId: original.pages[1].preview_id,
    })
  })
  await waitFor(() =>
    expect(screen.getByRole('img')).toHaveAttribute(
      'src',
      expect.stringContaining(original.pages[1].preview_id),
    ),
  )
  await act(async () => {
    location.hash = withEvidence(path, { ...first, previewId: replacement.pages[0].preview_id })
  })
  await waitFor(() => expect(screen.queryByRole('img')).not.toBeInTheDocument())
  expect(screen.getByText(/no replacement has been substituted/)).toBeVisible()
  await act(async () => {
    location.hash = path + '?source=invalid'
  })
  await waitFor(() => expect(screen.getByText(/link is incomplete or invalid/)).toBeVisible())
  await act(async () => {
    location.hash = path
  })
  await waitFor(() =>
    expect(new URLSearchParams(location.hash.split('?')[1]).get('preview')).toBe(
      original.pages[0].preview_id,
    ),
  )
  expect(screen.getByRole('img')).toHaveAttribute(
    'src',
    expect.stringContaining(original.pages[0].preview_id),
  )
  history.replaceState(null, '', '#')
})

function GuardedEvidence() {
  const { onDirtyChange } = useNavigationGuard()
  useEffect(() => {
    onDirtyChange(true)
  }, [onDirtyChange])
  return <EvidenceViewer batchId="batch" lotId="lot" evidence={[evidence]} />
}

test('same-lot inspection navigation cannot bypass the real application dirty-URL guard', async () => {
  const path = '#batch/review/lots/lot'
  const first = {
    evidenceId: evidence.id,
    versionId: original.id,
    page: 1,
    previewId: original.pages[0].preview_id,
  }
  const protectedHash = withEvidence(path, first)
  history.replaceState(null, '', protectedHash)
  render(<GuardedEvidence />)
  await act(async () => {
    location.hash = withEvidence(path, {
      ...first,
      page: 2,
      previewId: original.pages[1].preview_id,
    })
  })
  await waitFor(() => expect(location.hash).toBe(protectedHash))
  expect(screen.getByRole('img')).toHaveAttribute(
    'src',
    expect.stringContaining(original.pages[0].preview_id),
  )
  history.replaceState(null, '', '#')
})

test('retained group and evidence notes are readable without replacing source identities', () => {
  const note = {
    id: '80000000-0000-4000-8000-000000000008',
    version: '2',
    text: 'Read the original pencil marking.',
    actor_id: '90000000-0000-4000-8000-000000000009',
    created_at: '2026-11-03T00:00:00Z',
  }
  const groupId = '70000000-0000-4000-8000-000000000007'
  render(
    <EvidenceViewer
      batchId="batch"
      evidence={[{ ...evidence, group_id: groupId, note }]}
      groups={[
        {
          id: groupId,
          label: 'Opened packet',
          note: {
            ...note,
            id: '60000000-0000-4000-8000-000000000006',
            text: 'Do not combine these physical lots.',
          },
        },
      ]}
    />,
  )
  expect(screen.getByText('Read the original pencil marking.')).toBeVisible()
  expect(screen.getByText('Do not combine these physical lots.')).toBeVisible()
  expect(screen.getByRole('img')).toHaveAttribute(
    'src',
    '/api/v1/batches/batch/media/previews/30000000-0000-4000-8000-000000000003',
  )
  expect(screen.getAllByText(/Version 2/)).toHaveLength(2)
})

test('a uniquely named file is labelled by name and kind, with no identifier inline', () => {
  render(<EvidenceViewer batchId="batch" evidence={[evidence]} />)
  const source = screen.getByLabelText('Evidence source and version')

  expect(source).toHaveTextContent('Packing slip · original')
  expect(source.textContent).not.toMatch(/[0-9a-f]{8}/)
})

test('two files with one name are told apart by number, with identifiers only in Details', () => {
  const second: MediaEvidenceDto = {
    ...evidence,
    id: '10000000-0000-4000-8000-0000000000ee',
    versions: [
      {
        ...original,
        id: '20000000-0000-4000-8000-0000000000ee',
        evidence_id: '10000000-0000-4000-8000-0000000000ee',
      },
    ],
  }
  render(<EvidenceViewer batchId="batch" evidence={[evidence, second]} />)
  const source = screen.getByLabelText('Evidence source and version')

  expect(source).toHaveTextContent('Packing slip (1) · original')
  expect(source).toHaveTextContent('Packing slip (2) · original')
  expect(source.textContent).not.toMatch(/[0-9a-f]{8}/)
  expect(screen.getByText('Details').closest('details')?.textContent).toMatch(
    /evidence [0-9a-f]{8}/,
  )
})

test('names are numbered across the snapshot it is given, and Details pairs each with its identifier', () => {
  const twin = (id: string): MediaEvidenceDto => ({
    ...evidence,
    id: `10000000-0000-4000-8000-0000000000${id}`,
    versions: [
      {
        ...original,
        id: `20000000-0000-4000-8000-0000000000${id}`,
        evidence_id: `10000000-0000-4000-8000-0000000000${id}`,
      },
    ],
  })

  const all = [twin('a1'), twin('b2'), twin('d4')]
  render(
    <EvidenceViewer batchId="batch" evidence={[all[1], all[2]]} labels={mediaDisplayLabels(all)} />,
  )
  const source = screen.getByLabelText('Evidence source and version')

  expect(source).toHaveTextContent('Packing slip (2) · original')
  expect(source).toHaveTextContent('Packing slip (3) · original')
  expect(source).not.toHaveTextContent('Packing slip (1)')
  expect(screen.getByRole('img')).toHaveAccessibleName('Packing slip (2) · original · page 1')
  expect(screen.getByText('Details').closest('details')?.textContent).toMatch(
    /Packing slip \(2\) · original: Packing slip · evidence 10000000/,
  )
})

test('the viewer loads the view size, then the full page once zoom and density need it', async () => {
  const photo: MediaVersionDto = {
    ...original,
    id: '70000000-0000-4000-8000-000000000007',
    media_type: 'image/jpeg',
    pages: [
      { page: 1, width: 4032, height: 3024, preview_id: '80000000-0000-4000-8000-000000000008' },
    ],
  }
  const width = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'clientWidth')
  const ratio = window.devicePixelRatio
  Object.defineProperty(HTMLElement.prototype, 'clientWidth', {
    configurable: true,
    get: () => 900,
  })
  const full = '/api/v1/batches/batch/media/previews/80000000-0000-4000-8000-000000000008'
  try {
    const user = userEvent.setup()
    window.devicePixelRatio = 1
    const view = render(
      <EvidenceViewer batchId="batch" evidence={[{ ...evidence, versions: [photo] }]} />,
    )
    // 900 px at 1× needs no more than the 2048 px view size.
    expect(screen.getByRole('img')).toHaveAttribute('src', `${full}?size=view`)
    expect(screen.getByRole('img').getAttribute('srcset')).not.toContain(`${full} `)
    await user.click(screen.getByRole('button', { name: 'Zoom in' }))
    await user.click(screen.getByRole('button', { name: 'Zoom in' }))
    await user.click(screen.getByRole('button', { name: 'Zoom in' }))
    // At 250% the image needs 2250 pixels, more than the view size holds.
    expect(screen.getByRole('img')).toHaveAttribute('src', full)
    expect(screen.getByRole('img')).not.toHaveAttribute('srcset')
    view.unmount()

    // On a 3× screen, 900 CSS pixels already need 2700 pixels at 100%.
    window.devicePixelRatio = 3
    render(<EvidenceViewer batchId="batch" evidence={[{ ...evidence, versions: [photo] }]} />)
    // Measured before the image mounts, so its very first source is already the full page.
    expect(screen.getByRole('img')).toHaveAttribute('src', full)
  } finally {
    window.devicePixelRatio = ratio
    if (width) {
      Object.defineProperty(HTMLElement.prototype, 'clientWidth', width)
    }
  }
})

test('the viewer re-decides when it moves to a denser display without resizing', async () => {
  const photo: MediaVersionDto = {
    ...original,
    id: '90000000-0000-4000-8000-000000000009',
    media_type: 'image/jpeg',
    pages: [
      { page: 1, width: 4032, height: 3024, preview_id: 'a0000000-0000-4000-8000-00000000000a' },
    ],
  }
  const width = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'clientWidth')
  const ratio = window.devicePixelRatio
  const listeners: (() => void)[] = []
  const media = window.matchMedia
  window.matchMedia = (() => ({
    addEventListener: (_: string, listener: () => void) => listeners.push(listener),
    removeEventListener: () => {},
  })) as unknown as typeof window.matchMedia
  Object.defineProperty(HTMLElement.prototype, 'clientWidth', {
    configurable: true,
    get: () => 900,
  })
  const full = '/api/v1/batches/batch/media/previews/a0000000-0000-4000-8000-00000000000a'
  try {
    window.devicePixelRatio = 1
    render(<EvidenceViewer batchId="batch" evidence={[{ ...evidence, versions: [photo] }]} />)
    expect(screen.getByRole('img')).toHaveAttribute('src', `${full}?size=view`)
    window.devicePixelRatio = 3
    act(() => listeners.forEach((listener) => listener()))
    expect(screen.getByRole('img')).toHaveAttribute('src', full)
  } finally {
    window.matchMedia = media
    window.devicePixelRatio = ratio
    if (width) {
      Object.defineProperty(HTMLElement.prototype, 'clientWidth', width)
    }
  }
})
