import userEvent from '@testing-library/user-event'
import { render, screen, within } from '@testing-library/react'
import { expect, it } from 'vitest'
import type {
  CaptureSnapshotDto,
  MediaSnapshotDto,
  ProcessingSnapshotDto,
} from '@invimport/contracts'
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

const media = {
  batch_id: 'b',
  revision: '1',
  groups: [],
  evidence: [
    {
      id: 'e1',
      label: 'bench.jpg',
      group_id: null,
      linked_subject_ids: [],
      versions: [{ id: 'v1' }],
    },
    {
      id: 'e2',
      label: 'reel.jpg',
      group_id: null,
      linked_subject_ids: [],
      versions: [{ id: 'v2' }],
    },
  ],
  attachments: [],
  derivations: [],
} as unknown as MediaSnapshotDto

it('names each photo by its file, with its group and what it feeds, and keeps coordinates in Details', () => {
  render(<ExamineView batch={batch} lead={lead} media={media} />)
  const bench = screen.getByRole('region', { name: 'bench.jpg' })
  expect(bench).toHaveTextContent('Not in a group · 2 observations · feeds 1 lot')
  expect(within(bench).getByRole('link', { name: 'Evidence in Capture' })).toHaveAttribute(
    'href',
    '#b/capture',
  )
  expect(within(bench).getAllByText(/region 0,0/)[0]).not.toBeVisible()
  expect(
    within(bench).getAllByRole('button', {
      name: 'Source: Examine, Read from the photo. Open evidence',
    }),
  ).toHaveLength(2)
  expect(screen.getByText('2 files · 3 observations · 1 lot')).toBeInTheDocument()
})

it('marks each lot formed as stable or questioned, with a count and the map', () => {
  render(<ExamineView batch={batch} lead={lead} questionedLots={new Set(['led'])} />)
  const formed = screen.getByRole('region', { name: 'Lots formed' })
  expect(within(formed).getByRole('link', { name: 'Open the map' })).toHaveAttribute(
    'href',
    '#b/review/map',
  )
  const lot = within(formed).getByLabelText('Lot LED reel')
  expect(within(lot).getByText('Question')).toBeVisible()
  expect(within(lot).getByText('AI-proposed').closest('[data-tone]')).toHaveAttribute(
    'data-tone',
    'acc',
  )
})

it('says a reading from document lines came from the document', () => {
  const lines = {
    ...batch,
    evidence_observations: [
      {
        ...observation('o9', 'v9', 'Invoice line 3', null),
        region: { kind: 'lines', from_line: 3, to_line: 3 },
      },
    ],
  } as unknown as CaptureSnapshotDto
  render(<ExamineView batch={lines} lead={lead} />)
  expect(
    screen.getByRole('button', { name: 'Source: Examine, Read from the document. Open evidence' }),
  ).toBeInTheDocument()
})

it('corrects a photo’s readings, marking the correction and the lot to re-examine', async () => {
  const user = userEvent.setup()
  const edits: unknown[] = []
  const corrected = {
    ...batch,
    lots: [{ ...batch.lots[0], operator_edited: true, reexamine: true }],
    evidence_observations: [
      { ...batch.evidence_observations![0], operator_edited: true, origin: 'agent' },
      ...batch.evidence_observations!.slice(1),
    ],
  } as unknown as CaptureSnapshotDto
  render(
    <ExamineView
      batch={corrected}
      lead={lead}
      edit={async (change) => {
        edits.push(change)
      }}
      askSharper={async () => {}}
    />,
  )
  const first = screen.getByLabelText('Photo 1')
  expect(within(first).getByText('Corrected by you')).toBeVisible()
  expect(within(screen.getByLabelText('Lot LED reel')).getByText('Re-examine')).toBeVisible()

  await user.click(within(first).getByRole('button', { name: 'Edit readings' }))
  const field = within(first).getByLabelText('Markings for 16 MHz crystal')
  await user.clear(field)
  await user.type(field, '16.000 MHz crystal, HC-49')
  await user.click(within(first).getByRole('button', { name: 'Save readings for 16 MHz crystal' }))
  expect(edits).toEqual([
    {
      kind: 'observation',
      observation_id: 'o2',
      evidence_version_id: 'v1',
      page: 1,
      region: pixels,
      readings: { markings: ['16.000 MHz crystal', 'HC-49'] },
    },
  ])
})

it('asks the lead session for a sharper photo', async () => {
  const user = userEvent.setup()
  const asked: string[] = []
  render(
    <ExamineView
      batch={batch}
      lead={lead}
      edit={async () => {}}
      askSharper={async (name) => {
        asked.push(name)
      }}
    />,
  )
  await user.click(
    within(screen.getByLabelText('Photo 2')).getByRole('button', {
      name: 'Ask for a sharper photo',
    }),
  )
  expect(asked).toEqual(['Photo 2'])
})

it('reports an unsaved reading and locks other corrections until it is saved or discarded', async () => {
  const user = userEvent.setup()
  const dirty: boolean[] = []
  render(
    <ExamineView
      batch={batch}
      lead={lead}
      edit={async () => false}
      askSharper={async () => {}}
      onDirtyChange={(value) => dirty.push(value)}
    />,
  )
  const first = screen.getByLabelText('Photo 1')
  await user.click(within(first).getByRole('button', { name: 'Edit readings' }))
  await user.type(within(first).getByLabelText('Markings for 16 MHz crystal'), ' 2')
  expect(dirty.at(-1)).toBe(true)
  expect(within(first).getByLabelText('Markings for LED 0603 red')).toBeDisabled()
  // The editor cannot be closed or left while it holds an unsaved draft.
  expect(within(first).getByRole('button', { name: 'Edit readings' })).toBeDisabled()
  await user.click(screen.getByRole('button', { name: 'By lot' }))
  expect(screen.getByLabelText('Markings for 16 MHz crystal')).toBeVisible()
  // A save that is not confirmed keeps the draft.
  await user.click(within(first).getByRole('button', { name: 'Save readings for 16 MHz crystal' }))
  expect(within(first).getByLabelText('Markings for 16 MHz crystal')).toHaveValue(
    '16 MHz crystal 2',
  )
})

it('retries an unconfirmed sharper-photo request with the same key, and says when it is sent', async () => {
  const user = userEvent.setup()
  const keys: string[] = []
  let fail = true
  render(
    <ExamineView
      batch={batch}
      lead={lead}
      edit={async () => {}}
      askSharper={async (_name, key) => {
        keys.push(key)
        if (fail) {
          throw new Error('lost')
        }
      }}
    />,
  )
  const second = screen.getByLabelText('Photo 2')
  await user.click(within(second).getByRole('button', { name: 'Ask for a sharper photo' }))
  expect(within(second).getByRole('alert')).toHaveTextContent(/not confirmed/)
  fail = false
  await user.click(within(second).getByRole('button', { name: 'Retry the request' }))
  expect(keys).toHaveLength(2)
  expect(keys[1]).toBe(keys[0])
  expect(within(second).getByRole('status')).toHaveTextContent('Asked Examine for a sharper photo')
})

it('keeps a failed request with its photo when the photo’s name arrives', async () => {
  const user = userEvent.setup()
  const sent: [string, string][] = []
  let fail = true

  const askSharper = async (name: string, key: string) => {
    sent.push([name, key])
    if (fail) {
      throw new Error('lost')
    }
  }

  const view = render(<ExamineView batch={batch} lead={lead} askSharper={askSharper} />)
  const unnamed = screen.getByLabelText('Photo 2')
  await user.click(within(unnamed).getByRole('button', { name: 'Ask for a sharper photo' }))
  view.rerender(<ExamineView batch={batch} lead={lead} media={media} askSharper={askSharper} />)
  fail = false
  const named = screen.getByRole('region', { name: 'reel.jpg' })
  expect(within(named).getByRole('alert')).toHaveTextContent(/not confirmed/)
  await user.click(within(named).getByRole('button', { name: 'Retry the request' }))
  expect(sent).toEqual([sent[0], sent[0]])
})
