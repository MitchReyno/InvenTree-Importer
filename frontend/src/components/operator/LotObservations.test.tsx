import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { expect, it, vi } from 'vitest'
import type { CaptureSnapshotDto } from '@invimport/contracts'
import { LotObservations } from './LotObservations'

const region = {
  kind: 'pixels',
  x: 0,
  y: 0,
  width: 10,
  height: 10,
  source_width: 768,
  source_height: 512,
}

const observation = (
  id: string,
  marking: string,
  lot: string | null,
  suggested: string[] = [],
) => ({
  id,
  evidence_version_id: 'v',
  page: 1,
  region,
  readings: { markings: [marking] },
  visible_count: null,
  status: 'active',
  supersedes_observation_id: null,
  origin: 'agent',
  agent_session_id: 's',
  operator_edited: false,
  revision: '5',
  lot_id: lot,
  suggested_lot_ids: suggested,
})

const lot = {
  id: 'l1',
  label: 'LED 0603 red',
  origin: 'agent',
  agent_session_id: 's',
  estimated_quantity: '500',
  quantity_basis: 'label · same item in 2 photos',
} as CaptureSnapshotDto['lots'][number]
const batch = {
  id: 'b',
  lots: [lot],
  evidence_observations: [
    observation('o1', 'LED 0603 red', 'l1'),
    observation('o2', 'Reel back', null, ['l1']),
  ],
} as unknown as CaptureSnapshotDto

it('shows the lot’s observations as crops and resolves suggestions as operator edits', async () => {
  const edit = vi.fn().mockResolvedValue(true)
  const { container } = render(
    <LotObservations batch={batch} lot={lot} edit={edit} disabled={false} />,
  )
  const section = screen.getByRole('region', { name: 'Observations' })
  expect(within(section).getByText('AI-proposed')).toBeInTheDocument()
  expect(
    within(section).getByText(/Estimated 500 · label · same item in 2 photos/),
  ).toBeInTheDocument()
  expect(container.querySelector('img')).toHaveAttribute(
    'src',
    '/api/v1/batches/b/media/observations/o1/crop',
  )
  const suggestion = screen.getByRole('listitem', { name: 'Suggested observation' })
  await userEvent.click(within(suggestion).getByRole('button', { name: 'Add to this lot' }))
  expect(edit).toHaveBeenCalledWith({
    kind: 'observation_suggestion',
    observation_id: 'o2',
    lot_id: 'l1',
    decision: 'accept',
  })
  await userEvent.click(within(suggestion).getByRole('button', { name: 'Dismiss' }))
  expect(edit).toHaveBeenLastCalledWith(expect.objectContaining({ decision: 'dismiss' }))
})

it('fences suggestion decisions while a draft is open', () => {
  render(<LotObservations batch={batch} lot={lot} edit={vi.fn()} disabled />)
  expect(screen.getByRole('button', { name: 'Add to this lot' })).toBeDisabled()
})

it('shows nothing for a lot with no observations', () => {
  const { container } = render(
    <LotObservations batch={{ ...batch, evidence_observations: [] }} lot={lot} disabled={false} />,
  )
  expect(container).toBeEmptyDOMElement()
})
