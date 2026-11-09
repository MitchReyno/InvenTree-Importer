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
    // A 10 × 10 region is no larger than any size, so it is served unscaled under its revision.
    '/api/v1/batches/b/media/observations/o1/crop?rev=v-1-0-0-10-10',
  )
  const suggestion = screen.getByRole('listitem', { name: 'Suggested observation' })
  await userEvent.click(
    within(suggestion).getByRole('button', { name: 'Add Reel back to LED 0603 red' }),
  )
  expect(edit).toHaveBeenCalledWith({
    kind: 'observation_suggestion',
    observation_id: 'o2',
    lot_id: 'l1',
    decision: 'accept',
  })
  await userEvent.click(
    within(suggestion).getByRole('button', { name: 'Dismiss Reel back for LED 0603 red' }),
  )
  expect(edit).toHaveBeenLastCalledWith(expect.objectContaining({ decision: 'dismiss' }))
})

it('fences suggestion decisions while a draft is open', () => {
  render(<LotObservations batch={batch} lot={lot} edit={vi.fn()} disabled />)
  expect(screen.getByRole('button', { name: /^Add Reel back/ })).toBeDisabled()
})

it('shows nothing for a lot with no observations', () => {
  const { container } = render(
    <LotObservations batch={{ ...batch, evidence_observations: [] }} lot={lot} disabled={false} />,
  )
  expect(container).toBeEmptyDOMElement()
})

it('offers the lead session’s revision of an edited observation to accept or dismiss', async () => {
  const edit = vi.fn().mockResolvedValue(true)
  const edited = { ...observation('o1', 'LED 0603 red', 'l1'), operator_edited: true }
  const revision = {
    ...observation('o3', 'LED 0603 red, lot 7', null),
    status: 'suggested',
    supersedes_observation_id: 'o1',
  }
  render(
    <LotObservations
      batch={
        { ...batch, evidence_observations: [edited, revision] } as unknown as CaptureSnapshotDto
      }
      lot={lot}
      edit={edit}
      disabled={false}
    />,
  )
  const item = screen.getByRole('listitem', { name: 'Suggested revision' })
  await userEvent.click(
    within(item).getByRole('button', { name: 'Use the suggested revision: LED 0603 red, lot 7' }),
  )
  expect(edit).toHaveBeenCalledWith({
    kind: 'observation_suggestion',
    observation_id: 'o3',
    decision: 'accept',
  })
})

it('requests the new crop when a mounted observation’s region is edited', () => {
  const large = { ...region, width: 1800, height: 1200, source_width: 4000, source_height: 3000 }

  const shown = (x: number) =>
    ({
      ...batch,
      evidence_observations: [
        { ...observation('o1', 'LED 0603 red', 'l1'), region: { ...large, x } },
      ],
    }) as unknown as CaptureSnapshotDto

  const view = render(
    <LotObservations batch={shown(0)} lot={lot} edit={vi.fn()} disabled={false} />,
  )
  const image = view.container.querySelector('img')!
  expect(image.getAttribute('src')).toContain('rev=v-1-0-0-1800-1200')
  view.rerender(<LotObservations batch={shown(40)} lot={lot} edit={vi.fn()} disabled={false} />)
  const moved = view.container.querySelector('img')!
  expect(moved.getAttribute('src')).toContain('rev=v-1-40-0-1800-1200')
  const candidates = moved.getAttribute('srcset')!.split(', ')
  expect(candidates.length).toBeGreaterThan(1)
  for (const candidate of candidates) {
    expect(candidate).toContain('rev=v-1-40-0-1800-1200')
  }
})

it('says in words what each reading came from and how well it agrees', () => {
  const said = {
    ...batch,
    evidence_observations: [
      {
        ...observation('o1', 'LED 0603 red', 'l1'),
        readings: { markings: ['LED 0603 red'], source_kind: 'label', agreement: 'likely' },
      },
    ],
  } as unknown as CaptureSnapshotDto
  render(<LotObservations batch={said} lot={lot} disabled={false} />)
  expect(screen.getByTitle('Examine · Label · Likely')).toBeInTheDocument()
})
