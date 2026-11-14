import { render, screen } from '@testing-library/react'
import type { MediaEvidenceDto, MediaVersionDto } from '@invimport/contracts'
import { describe, expect, it, vi } from 'vitest'
import { EvidenceFileTile } from './EvidenceFileTile'

const batchId = '10000000-0000-4000-8000-000000000001'

function version(id: string, overrides: Partial<MediaVersionDto>): MediaVersionDto {
  return {
    id,
    evidence_id: 'e',
    kind: 'original',
    digest: 'a'.repeat(64),
    byte_size: '10',
    media_type: 'image/jpeg',
    state: 'ready',
    decoder_build: 'fixture/1',
    recipe: null,
    pages: [{ page: 1, width: 10, height: 10, preview_id: `preview-${id}` }],
    ...overrides,
  } as MediaVersionDto
}

function tile(versions: MediaVersionDto[]) {
  const evidence = {
    id: 'e',
    label: 'Packet',
    group_id: null,
    linked_subject_ids: [],
    versions,
  } as MediaEvidenceDto
  return render(
    <EvidenceFileTile
      batchId={batchId}
      evidence={evidence}
      name="Packet"
      support="2 lots"
      selectable
      selected={false}
      onSelect={vi.fn()}
      onOpen={vi.fn()}
    />,
  )
}

describe('EvidenceFileTile', () => {
  it('shows a ready crop in place of its original', () => {
    tile([version('o', {}), version('d', { kind: 'derived' })])

    expect(
      screen.getByRole('button', { name: 'Open Packet' }).querySelector('img'),
    ).toHaveAttribute('src', expect.stringContaining('preview-d'))
    expect(screen.getByText('2 lots')).toBeInTheDocument()
  })

  it('loads a card-sized preview of a large photo, with its intrinsic size', () => {
    tile([
      version('o', {
        pages: [{ page: 1, width: 4032, height: 3024, preview_id: 'preview-o' }],
      }),
    ])
    const image = screen.getByRole('button', { name: 'Open Packet' }).querySelector('img')!
    expect(image.getAttribute('srcset')).toContain('preview-o?size=card 960w')
    expect(image.getAttribute('srcset')).not.toContain('preview-o 4032w')
    expect([image.getAttribute('width'), image.getAttribute('height')]).toEqual(['4032', '3024'])
    expect(image).toHaveAttribute('loading', 'lazy')
  })

  it('says a preview is being prepared or could not be made, without decoder detail', () => {
    const { unmount } = tile([version('o', { state: 'queued', pages: [] })])
    expect(screen.getByText('Preparing…')).toBeInTheDocument()
    unmount()

    tile([version('o', { state: 'malformed', pages: [] })])
    expect(screen.getByText('The preview couldn’t be made.')).toBeInTheDocument()
    expect(screen.queryByText(/malformed/)).not.toBeInTheDocument()
  })

  it('tags PDFs as documents', () => {
    tile([version('o', { media_type: 'application/pdf' })])

    expect(screen.getByText('Document')).toBeInTheDocument()
  })
})
