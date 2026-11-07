import userEvent from '@testing-library/user-event'
import { render, screen, within } from '@testing-library/react'
import { expect, it } from 'vitest'
import type { CaptureSnapshotDto, ProcessingSnapshotDto } from '@invimport/contracts'
import { ExamineView } from './ExamineView'

const pixels = {
  kind: 'pixels',
  x: 0,
  y: 0,
  width: 10,
  height: 10,
  source_width: 768,
  source_height: 512,
}

const observation = (id: string, version: string, marking: string, lot: string | null) => ({
  id,
  evidence_version_id: version,
  page: 1,
  region: pixels,
  readings: { markings: [marking] },
  visible_count: null,
  status: 'active',
  lot_id: lot,
  suggested_lot_ids: [],
})

const batch = {
  id: 'b',
  lots: [
    {
      id: 'led',
      label: 'LED reel',
      origin: 'agent',
      operator_edited: false,
      estimated_quantity: '500',
      quantity_basis: 'label · same item in 2 photos',
      evidence_observation_ids: ['o1', 'o3'],
    },
  ],
  evidence_observations: [
    observation('o1', 'v1', 'LED 0603 red', 'led'),
    observation('o2', 'v1', '16 MHz crystal', null),
    observation('o3', 'v2', 'LED 0603 red', 'led'),
  ],
} as unknown as CaptureSnapshotDto
const lead = {
  id: 'j',
  stage: 'examine',
  subject_id: null,
  proposals: [
    {
      id: 'p',
      message_id: 'm',
      value: {
        subject_id: 'led',
        summary: 'Identity from the label: LED 0603 red.',
        sources: [{ kind: 'note', note_id: 'n', text_sha256: 'a'.repeat(64) }],
      },
      currentness: { state: 'current' },
    },
  ],
} as unknown as ProcessingSnapshotDto['jobs'][number]

it('shows each photo’s regions with their lot, and each lot’s observations, candidate and basis', () => {
  render(<ExamineView batch={batch} lead={lead} />)
  const first = screen.getByLabelText('Photo 1')
  expect(within(first).getByRole('link', { name: 'LED reel' })).toBeVisible()
  expect(within(first).getByText('No lot')).toBeVisible()
  expect(within(screen.getByLabelText('Photo 2')).getAllByRole('img')).toHaveLength(1)

  const lot = screen.getByLabelText('Lot LED reel')
  expect(within(lot).getByText('AI-proposed')).toBeVisible()
  expect(within(lot).getByText('Estimated 500 · label · same item in 2 photos')).toBeVisible()
  expect(within(lot).getAllByRole('img')).toHaveLength(2)
  expect(within(lot).getByText(/Identity from the label/)).toBeVisible()
})

it('switches between the photos and the lots formed from them', async () => {
  render(<ExamineView batch={batch} lead={lead} />)
  const lens = screen.getByRole('group', { name: 'Examine lens' })
  expect(within(lens).getByRole('button', { name: 'By photo' })).toHaveAttribute(
    'aria-pressed',
    'true',
  )
  await userEvent.click(within(lens).getByRole('button', { name: 'By lot' }))
  expect(screen.queryByRole('region', { name: 'Regions by photo' })).not.toBeInTheDocument()
  expect(screen.getByRole('region', { name: 'Lots formed' })).toBeVisible()
})
