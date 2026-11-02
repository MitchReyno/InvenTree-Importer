import { fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { expect, test } from 'vitest'
import type { MediaEvidenceDto, MediaVersionDto } from '@invimport/contracts'
import { EvidenceViewer } from './EvidenceViewer'

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
  history.replaceState(null, '', '#batch/review/lot?filter=warnings')
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
  history.replaceState(null, '', '#batch/review/lot?source=untrusted')
  render(<EvidenceViewer batchId="batch" lotId="lot" evidence={[evidence]} />)
  expect(screen.queryByRole('img')).not.toBeInTheDocument()
  expect(screen.getByText(/link is incomplete or invalid/)).toBeVisible()
  history.replaceState(null, '', '#')
})
