import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { expect, it, vi } from 'vitest'
import type { CaptureSnapshotDto } from '@invimport/contracts'
import { UnassignedObservations } from './UnassignedObservations'

const base = {
  evidence_version_id: 'v',
  page: 1,
  region: { kind: 'lines', from_line: 1, to_line: 2 },
  visible_count: null,
  origin: 'agent',
  agent_session_id: 's',
  revision: '5',
}
const batch = {
  id: 'b',
  lots: [{ id: 'l1', label: 'Red LEDs' }],
  evidence_observations: [
    {
      ...base,
      id: 'o1',
      readings: { markings: ['Reel back'] },
      status: 'active',
      supersedes_observation_id: null,
      operator_edited: true,
      lot_id: null,
      suggested_lot_ids: ['l1'],
    },
    {
      ...base,
      id: 'o2',
      readings: { markings: ['Reel back, lot 7'] },
      status: 'suggested',
      supersedes_observation_id: 'o1',
      operator_edited: false,
      lot_id: null,
      suggested_lot_ids: [],
    },
  ],
} as unknown as CaptureSnapshotDto

it('lets the operator resolve suggestions for observations in no lot', async () => {
  const edit = vi.fn().mockResolvedValue(true)
  render(<UnassignedObservations batch={batch} edit={edit} disabled={false} />)
  await userEvent.click(screen.getByRole('button', { name: 'Add Reel back to Red LEDs' }))
  expect(edit).toHaveBeenCalledWith({
    kind: 'observation_suggestion',
    observation_id: 'o1',
    lot_id: 'l1',
    decision: 'accept',
  })
  await userEvent.click(
    screen.getByRole('button', { name: 'Dismiss the suggested revision: Reel back, lot 7' }),
  )
  expect(edit).toHaveBeenLastCalledWith({
    kind: 'observation_suggestion',
    observation_id: 'o2',
    decision: 'dismiss',
  })
})

it('renders nothing when every observation is in a lot', () => {
  const { container } = render(
    <UnassignedObservations batch={{ ...batch, evidence_observations: [] }} disabled={false} />,
  )
  expect(container).toBeEmptyDOMElement()
})
