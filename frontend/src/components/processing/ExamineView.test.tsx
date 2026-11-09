import userEvent from '@testing-library/user-event'
import { act, render, screen, within } from '@testing-library/react'
import { expect, it } from 'vitest'
import type {
  CaptureSnapshotDto,
  MediaSnapshotDto,
  ProcessingSnapshotDto,
} from '@invimport/contracts'
import { createSharperRequestStore, ExamineView } from './ExamineView'

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
  const field = within(first).getByLabelText('Marking 1 for 16 MHz crystal')
  await user.clear(field)
  await user.type(field, '16.000 MHz crystal')
  await user.click(within(first).getByRole('button', { name: 'Add a marking for 16 MHz crystal' }))
  await user.type(within(first).getByLabelText('Marking 2 for 16 MHz crystal'), 'HC-49')
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
  await user.type(within(first).getByLabelText('Marking 1 for 16 MHz crystal'), ' 2')
  expect(dirty.at(-1)).toBe(true)
  expect(within(first).getByLabelText('Marking 1 for LED 0603 red')).toBeDisabled()
  // The editor cannot be closed or left while it holds an unsaved draft.
  expect(within(first).getByRole('button', { name: 'Edit readings' })).toBeDisabled()
  await user.click(screen.getByRole('button', { name: 'By lot' }))
  expect(screen.getByLabelText('Marking 1 for 16 MHz crystal')).toBeVisible()
  // A save that is not confirmed keeps the draft.
  await user.click(within(first).getByRole('button', { name: 'Save readings for 16 MHz crystal' }))
  expect(within(first).getByLabelText('Marking 1 for 16 MHz crystal')).toHaveValue(
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

it('a request still sending when the view remounts settles in the new view', async () => {
  const user = userEvent.setup()
  const sent: [string, string][] = []
  let settle: { resolve: () => void; reject: (reason: Error) => void } | null = null

  const askSharper = (name: string, key: string) => {
    sent.push([name, key])
    return new Promise<void>((resolve, reject) => {
      settle = { resolve, reject }
    })
  }

  const store = createSharperRequestStore()

  const view = () => (
    <ExamineView
      batch={batch}
      lead={lead}
      media={media}
      askSharper={askSharper}
      requestStore={store}
    />
  )

  const first = render(view())

  const reel = () => screen.getByRole('region', { name: 'reel.jpg' })

  await user.click(within(reel()).getByRole('button', { name: 'Ask for a sharper photo' }))
  first.unmount()
  render(view())
  expect(within(reel()).getByRole('button', { name: 'Ask for a sharper photo' })).toBeDisabled()
  await act(async () => settle!.reject(new Error('lost')))
  await user.click(within(reel()).getByRole('button', { name: 'Retry the request' }))
  expect(sent).toEqual([sent[0], sent[0]])
  await act(async () => settle!.resolve())
  expect(within(reel()).getByRole('status')).toHaveTextContent('Asked Examine for a sharper photo')
})

it('keeps a marking that contains a comma when another marking is corrected', async () => {
  const user = userEvent.setup()
  const edits: unknown[] = []
  const comma = {
    ...batch,
    evidence_observations: [
      {
        ...observation('o9', 'v1', '4,7 kΩ', 'l1'),
        readings: { markings: ['4,7 kΩ', 'R1'] },
      },
    ],
  } as unknown as CaptureSnapshotDto
  render(
    <ExamineView
      batch={comma}
      lead={lead}
      edit={async (change) => {
        edits.push(change)
      }}
    />,
  )
  const photo = screen.getByLabelText('Photo 1')
  await user.click(within(photo).getByRole('button', { name: 'Edit readings' }))
  await user.type(within(photo).getByLabelText('Marking 2 for 4,7 kΩ · R1'), '0')
  await user.click(within(photo).getByRole('button', { name: 'Save readings for 4,7 kΩ · R1' }))
  expect(edits).toEqual([
    expect.objectContaining({ readings: expect.objectContaining({ markings: ['4,7 kΩ', 'R10'] }) }),
  ])
})

it('keeps a region draft while the media read fails, and saves once it returns', async () => {
  const user = userEvent.setup()
  const edits: unknown[] = []
  const paged = {
    ...media,
    evidence: [
      {
        ...media.evidence[0],
        versions: [
          {
            id: 'v1',
            kind: 'original',
            pages: [{ page: 1, preview_id: 'p1', width: 768, height: 512 }],
          },
        ],
      },
      media.evidence[1],
    ],
  } as unknown as MediaSnapshotDto

  const view = (current?: MediaSnapshotDto) => (
    <ExamineView
      batch={batch}
      lead={lead}
      media={current}
      edit={async (change) => {
        edits.push(change)
      }}
    />
  )

  const mounted = render(view(paged))

  const bench = () => screen.getByRole('region', { name: 'bench.jpg' })

  await user.click(within(bench()).getByRole('button', { name: 'Adjust regions' }))
  await user.click(within(bench()).getByRole('button', { name: 'Add a region' }))
  const left = within(bench()).getByLabelText('Left')
  await user.clear(left)
  await user.type(left, '10')
  mounted.rerender(view(undefined))
  expect(screen.getByLabelText('Left')).toHaveValue(10)
  expect(screen.getByRole('button', { name: 'Save region' })).toBeDisabled()
  mounted.rerender(view(paged))
  expect(within(bench()).getByLabelText('Left')).toHaveValue(10)
  await user.click(within(bench()).getByRole('button', { name: 'Save region' }))
  expect(edits).toHaveLength(1)
})

const readingsBatch = {
  ...batch,
  evidence_observations: [
    {
      ...observation('o8', 'v1', 'x', 'l1'),
      readings: { markings: ['ABC\n123', 'XYZ'], text: 'Lot 4S' },
    },
    { ...observation('o7', 'v2', 'y', 'l1'), readings: { markings: [], text: 'Bacth 12' } },
  ],
} as unknown as CaptureSnapshotDto

it('corrects the text of a reading that has no markings', async () => {
  const user = userEvent.setup()
  const edits: unknown[] = []
  render(
    <ExamineView
      batch={readingsBatch}
      lead={lead}
      edit={async (change) => void edits.push(change)}
    />,
  )
  const second = screen.getByLabelText('Photo 2')
  await user.click(within(second).getByRole('button', { name: 'Edit readings' }))
  const text = within(second).getByLabelText('Text for Bacth 12')
  await user.clear(text)
  await user.type(text, 'Batch 12')
  await user.click(within(second).getByRole('button', { name: 'Save readings for Bacth 12' }))
  expect(edits).toEqual([expect.objectContaining({ readings: { markings: [], text: 'Batch 12' } })])
})

it('keeps a marking that spans lines whole when another is corrected', async () => {
  const user = userEvent.setup()
  const edits: unknown[] = []
  render(
    <ExamineView
      batch={readingsBatch}
      lead={lead}
      edit={async (change) => void edits.push(change)}
    />,
  )
  const first = screen.getByLabelText('Photo 1')
  await user.click(within(first).getByRole('button', { name: 'Edit readings' }))
  await user.type(within(first).getByLabelText('Marking 2 for ABC 123 · XYZ'), 'Z')
  await user.click(within(first).getByRole('button', { name: 'Save readings for ABC 123 · XYZ' }))
  expect(edits).toEqual([
    expect.objectContaining({ readings: { markings: ['ABC\n123', 'XYZZ'], text: 'Lot 4S' } }),
  ])
})

it('says in words what a reading came from and how well it agrees', () => {
  const said = {
    ...batch,
    evidence_observations: [
      {
        ...observation('o6', 'v1', 'BC547', 'l1'),
        readings: { markings: ['BC547'], source_kind: 'handwriting', agreement: 'disagree' },
      },
    ],
  } as unknown as CaptureSnapshotDto
  render(<ExamineView batch={said} lead={lead} />)
  expect(screen.getByText('Examine · Handwriting · Sources disagree')).toBeInTheDocument()
})

it('releases the guard when Examine unmounts with an unsaved reading', async () => {
  const user = userEvent.setup()
  const dirty: boolean[] = []
  const view = render(
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
  await user.type(within(first).getByLabelText('Marking 1 for 16 MHz crystal'), ' 2')
  expect(dirty.at(-1)).toBe(true)
  view.unmount()
  expect(dirty.at(-1)).toBe(false)
})

it('a confirmed reading save releases the guard and the other corrections', async () => {
  const user = userEvent.setup()
  const dirty: boolean[] = []
  render(
    <ExamineView
      batch={batch}
      lead={lead}
      edit={async () => true}
      askSharper={async () => {}}
      onDirtyChange={(value) => dirty.push(value)}
    />,
  )
  const first = screen.getByLabelText('Photo 1')
  await user.click(within(first).getByRole('button', { name: 'Edit readings' }))
  await user.type(within(first).getByLabelText('Marking 1 for 16 MHz crystal'), ' 2')
  await user.click(within(first).getByRole('button', { name: 'Save readings for 16 MHz crystal' }))
  expect(dirty.at(-1)).toBe(false)
  expect(within(first).getByLabelText('Marking 1 for LED 0603 red')).toBeEnabled()
})

it('typing a reading back to its saved text, or discarding it, releases the guard', async () => {
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
  const field = within(first).getByLabelText('Marking 1 for 16 MHz crystal')
  await user.type(field, '!')
  expect(dirty.at(-1)).toBe(true)
  await user.type(field, '{Backspace}')
  expect(dirty.at(-1)).toBe(false)
  await user.type(field, '!')
  await user.click(within(first).getByRole('button', { name: 'Discard' }))
  expect(field).toHaveValue('16 MHz crystal')
  expect(dirty.at(-1)).toBe(false)
})

it('readings that catch up with an unconfirmed draft release the guard', async () => {
  const user = userEvent.setup()
  const dirty: boolean[] = []

  const view = (current: CaptureSnapshotDto) => (
    <ExamineView
      batch={current}
      lead={lead}
      edit={async () => false}
      askSharper={async () => {}}
      onDirtyChange={(value) => dirty.push(value)}
    />
  )

  const mounted = render(view(batch))
  const first = screen.getByLabelText('Photo 1')
  await user.click(within(first).getByRole('button', { name: 'Edit readings' }))
  await user.type(within(first).getByLabelText('Marking 1 for 16 MHz crystal'), ' 2')
  await user.click(within(first).getByRole('button', { name: 'Save readings for 16 MHz crystal' }))
  expect(dirty.at(-1)).toBe(true)
  const saved = {
    ...batch,
    evidence_observations: [
      observation('o1', 'v1', 'LED 0603 red', 'led'),
      observation('o2', 'v1', '16 MHz crystal 2', null),
      observation('o3', 'v2', 'LED 0603 red', 'led'),
    ],
  } as unknown as CaptureSnapshotDto
  mounted.rerender(view(saved))
  expect(dirty.at(-1)).toBe(false)
  expect(within(first).getByLabelText('Marking 1 for LED 0603 red')).toBeEnabled()
})

it('readings that change under a clean editor report it unsaved', async () => {
  const user = userEvent.setup()
  const dirty: boolean[] = []

  const view = (current: CaptureSnapshotDto) => (
    <ExamineView
      batch={current}
      lead={lead}
      edit={async () => false}
      askSharper={async () => {}}
      onDirtyChange={(value) => dirty.push(value)}
    />
  )

  const mounted = render(view(batch))
  const first = screen.getByLabelText('Photo 1')
  await user.click(within(first).getByRole('button', { name: 'Edit readings' }))
  expect(dirty.at(-1) ?? false).toBe(false)
  const reread = {
    ...batch,
    evidence_observations: [
      observation('o1', 'v1', 'LED 0603 red', 'led'),
      observation('o2', 'v1', '16 MHz crystal HC-49', null),
      observation('o3', 'v2', 'LED 0603 red', 'led'),
    ],
  } as unknown as CaptureSnapshotDto
  mounted.rerender(view(reread))
  expect(dirty.at(-1)).toBe(true)
})

it('after a confirmed save, readings that catch up with a later unconfirmed save release the guard', async () => {
  const user = userEvent.setup()
  const dirty: boolean[] = []
  const results = [true, false]

  const view = (current: CaptureSnapshotDto) => (
    <ExamineView
      batch={current}
      lead={lead}
      edit={async () => results.shift() ?? false}
      askSharper={async () => {}}
      onDirtyChange={(value) => dirty.push(value)}
    />
  )

  const mounted = render(view(batch))
  const first = screen.getByLabelText('Photo 1')
  await user.click(within(first).getByRole('button', { name: 'Edit readings' }))
  const field = within(first).getByLabelText('Marking 1 for 16 MHz crystal')
  await user.type(field, ' A')
  await user.click(within(first).getByRole('button', { name: 'Save readings for 16 MHz crystal' }))
  expect(dirty.at(-1)).toBe(false)
  await user.type(field, 'B')
  await user.click(within(first).getByRole('button', { name: 'Save readings for 16 MHz crystal' }))
  expect(dirty.at(-1)).toBe(true)
  const saved = {
    ...batch,
    evidence_observations: [
      observation('o1', 'v1', 'LED 0603 red', 'led'),
      observation('o2', 'v1', '16 MHz crystal AB', null),
      observation('o3', 'v2', 'LED 0603 red', 'led'),
    ],
  } as unknown as CaptureSnapshotDto
  mounted.rerender(view(saved))
  expect(dirty.at(-1)).toBe(false)
  expect(within(first).getByLabelText('Marking 1 for LED 0603 red')).toBeEnabled()
})

it('after a confirmed save, a region read again reports the editor unsaved', async () => {
  const user = userEvent.setup()
  const dirty: boolean[] = []

  const view = (current: CaptureSnapshotDto) => (
    <ExamineView
      batch={current}
      lead={lead}
      edit={async () => true}
      askSharper={async () => {}}
      onDirtyChange={(value) => dirty.push(value)}
    />
  )

  const mounted = render(view(batch))
  const first = screen.getByLabelText('Photo 1')
  await user.click(within(first).getByRole('button', { name: 'Edit readings' }))
  await user.type(within(first).getByLabelText('Marking 1 for 16 MHz crystal'), ' A')
  await user.click(within(first).getByRole('button', { name: 'Save readings for 16 MHz crystal' }))
  expect(dirty.at(-1)).toBe(false)
  const reread = {
    ...batch,
    evidence_observations: [
      observation('o1', 'v1', 'LED 0603 red', 'led'),
      observation('o2', 'v1', '16 MHz crystal HC-49', null),
      observation('o3', 'v2', 'LED 0603 red', 'led'),
    ],
  } as unknown as CaptureSnapshotDto
  mounted.rerender(view(reread))
  expect(dirty.at(-1)).toBe(true)
})

it('a confirmed save of an untidy draft stays clean when the batch reloads its saved form', async () => {
  const user = userEvent.setup()
  const dirty: boolean[] = []
  const saved = {
    ...batch,
    evidence_observations: [
      observation('o1', 'v1', 'LED 0603 red', 'led'),
      observation('o2', 'v1', '16 MHz crystal X', null),
      observation('o3', 'v2', 'LED 0603 red', 'led'),
    ],
  } as unknown as CaptureSnapshotDto
  let current = batch

  const view = () => (
    <ExamineView
      batch={current}
      lead={lead}
      edit={async () => {
        current = saved
        mounted.rerender(view())
        return true
      }}
      askSharper={async () => {}}
      onDirtyChange={(value) => dirty.push(value)}
    />
  )

  const mounted = render(view())
  const first = screen.getByLabelText('Photo 1')
  await user.click(within(first).getByRole('button', { name: 'Edit readings' }))
  await user.type(within(first).getByLabelText('Marking 1 for 16 MHz crystal'), ' X  ')
  await user.click(within(first).getByRole('button', { name: 'Add a marking for 16 MHz crystal' }))
  await user.click(within(first).getByRole('button', { name: 'Save readings for 16 MHz crystal' }))
  expect(dirty.at(-1)).toBe(false)
  expect(within(first).queryByRole('button', { name: 'Discard' })).toBeNull()
  expect(within(first).getByLabelText('Marking 1 for LED 0603 red')).toBeEnabled()
})
