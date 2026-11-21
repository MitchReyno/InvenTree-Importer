import { screen } from '@testing-library/react'
import { expect, test, vi } from 'vitest'
import { render } from '#/test/render'
import { ProcessingImages } from './ProcessingImages'
import type { MediaSnapshotDto } from '@invimport/contracts'

const saved: MediaSnapshotDto = {
  batch_id: 'batch',
  revision: '1',
  attachments: [],
  groups: [],
  derivations: [],
  evidence: [
    {
      id: 'source',
      label: 'Saved packet',
      group_id: null,
      linked_subject_ids: ['lot'],
      versions: [
        {
          id: 'version',
          evidence_id: 'source',
          kind: 'original',
          digest: 'a'.repeat(64),
          byte_size: '10',
          media_type: 'image/png',
          state: 'ready',
          decoder_build: 'fixture',
          recipe: null,
          pages: [{ page: 1, width: 10, height: 10, preview_id: 'preview' }],
        },
      ],
    },
  ],
}

test('Images exposes saved output inspection and Capture link without choosing an attachment', async () => {
  const client = {
    snapshot: vi.fn(async () => saved),
    removalImpact: vi.fn(),
    upload: vi.fn(),
    edit: vi.fn(),
  }
  render(<ProcessingImages batchId="batch" client={client} />)
  expect(await screen.findByRole('heading', { name: 'Saved packet' })).toBeVisible()
  expect(screen.getByRole('link', { name: 'Open exact original preview' })).toHaveAttribute(
    'href',
    '/api/v1/batches/batch/media/previews/preview',
  )
  expect(screen.getByRole('link', { name: /prepare another crop/ })).toHaveAttribute(
    'href',
    '#batch/capture',
  )
  expect(client.edit).not.toHaveBeenCalled()
  expect(client.upload).not.toHaveBeenCalled()
})

test('failed media reads report unavailable, not an empty successful gallery', async () => {
  const client = {
    snapshot: vi.fn().mockRejectedValue(new Error('offline')),
    upload: vi.fn(),
    removalImpact: vi.fn(),
    edit: vi.fn(),
  }
  render(<ProcessingImages batchId="batch" client={client} />)
  expect(await screen.findByRole('alert')).toHaveTextContent('Current media status is unavailable')
  expect(screen.queryByText('No retained images or documents yet.')).not.toBeInTheDocument()
})
