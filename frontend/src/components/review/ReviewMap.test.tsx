import { cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { CaptureSnapshotDto, MediaSnapshotDto } from '@invimport/contracts'
import { describe, expect, it, vi } from 'vitest'
import { ReviewMap } from './ReviewMap'

const lot = (id: string, label: string, part: string | null = null) => ({
  id,
  label,
  part_subject_id: part,
})

const batch = {
  id: 'b',
  archived: false,
  lots: [lot('a', 'Packet A', 'p1'), lot('b', 'Packet B', 'p1'), lot('c', 'Bag')],
  parts: [],
} as unknown as CaptureSnapshotDto

const file = (id: string, label: string, linked: string[]) => ({
  id,
  label,
  linked_subject_ids: linked,
})

const evidence = [
  file('f1', 'Front label', ['a']),
  file('f2', 'Packing slip', ['p1']),
  file('f3', 'Bag photo', ['c']),
  file('f4', 'Stray photo', []),
] as unknown as MediaSnapshotDto['evidence']

function map(overrides: Partial<Parameters<typeof ReviewMap>[0]> = {}) {
  const props = {
    batch,
    evidence,
    retiredLotIds: new Set<string>(),
    disabled: false,
    link: vi.fn(async () => undefined),
    newLotFrom: vi.fn(async () => undefined),
    openRestructure: vi.fn(),
    approvedLotIds: new Set<string>(),
    loading: false,
    ...overrides,
  }
  render(<ReviewMap {...props} />)
  return props
}

describe('ReviewMap', () => {
  it('flags unused evidence and lots resting on a single file', () => {
    map()
    const files = screen.getByRole('region', { name: 'Evidence' })
    const lots = screen.getByRole('region', { name: 'Lots' })

    expect(within(files).getByRole('listitem', { name: /Stray photo/ })).toHaveTextContent(
      'Used by no lot',
    )
    expect(within(files).getByRole('listitem', { name: /Front label/ })).not.toHaveTextContent(
      'Used by no lot',
    )
    expect(within(lots).getByRole('listitem', { name: /Packet B/ })).toHaveTextContent(
      'Rests on one file',
    )
    expect(within(lots).getByRole('listitem', { name: /Packet A/ })).not.toHaveTextContent(
      'Rests on one file',
    )
  })

  it('links a file to a lot and unlinks it', async () => {
    const user = userEvent.setup()
    const props = map()
    const stray = screen.getByRole('listitem', { name: /Stray photo/ })

    await user.selectOptions(within(stray).getByLabelText('Link Stray photo to a lot'), 'c')
    await user.click(within(stray).getByRole('button', { name: 'Link' }))
    expect(props.link).toHaveBeenCalledWith('f4', 'c', true)

    await user.click(screen.getByRole('button', { name: 'Unlink Packet A from Front label' }))
    expect(props.link).toHaveBeenCalledWith('f1', 'a', false)
  })

  it('makes a new lot from an unused file', async () => {
    const user = userEvent.setup()
    const props = map()

    await user.click(screen.getByRole('button', { name: 'New lot from this: Stray photo' }))
    expect(props.newLotFrom).toHaveBeenCalledWith('f4', 'Stray photo')
    expect(
      screen.queryByRole('button', { name: 'New lot from this: Front label' }),
    ).not.toBeInTheDocument()
  })

  it('offers split and merge through the existing commands', async () => {
    const user = userEvent.setup()
    const props = map()

    await user.click(screen.getByRole('button', { name: 'Split Bag' }))
    expect(props.openRestructure).toHaveBeenCalledWith('split', ['c'])

    await user.click(screen.getByRole('checkbox', { name: 'Choose Packet A to merge or move' }))
    await user.click(screen.getByRole('checkbox', { name: 'Choose Packet B to merge or move' }))
    await user.click(screen.getByRole('button', { name: 'Merge 2 lots' }))
    expect(props.openRestructure).toHaveBeenCalledWith('merge', ['a', 'b'])
  })

  it('has no instruction field before agent sessions exist', () => {
    map()

    expect(screen.getByRole('region', { name: 'Lots' })).toBeInTheDocument()
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument()
  })

  it('says when evidence is unavailable or still being read', () => {
    map({ evidence: undefined })
    expect(screen.getByText(/Evidence is unavailable/)).toBeInTheDocument()
    cleanup()

    map({ loading: true })
    expect(screen.getByText('Reading evidence…')).toBeInTheDocument()
    expect(screen.queryByText('No evidence')).not.toBeInTheDocument()
  })

  it('shows a link through a Part as such, without an unlink that would not apply', () => {
    map()
    const slip = screen.getByRole('listitem', { name: /Packing slip/ })

    expect(within(slip).getAllByText(/via shared Part/)).toHaveLength(2)
    expect(within(slip).queryByRole('button', { name: /^Unlink Packet A/ })).not.toBeInTheDocument()
  })

  it('locks restructuring for added lots and moves lots through the existing command', async () => {
    const user = userEvent.setup()
    const props = map({ approvedLotIds: new Set(['c']) })

    expect(screen.getByRole('button', { name: 'Split Bag' })).toBeDisabled()
    expect(screen.getByRole('checkbox', { name: 'Choose Bag to merge or move' })).toBeDisabled()
    await user.click(screen.getByRole('checkbox', { name: 'Choose Packet A to merge or move' }))
    await user.click(screen.getByRole('button', { name: 'Move 1 lot to a Part proposal' }))
    expect(props.openRestructure).toHaveBeenCalledWith('move', ['a'])
  })

  it('locks restructuring until the latest review is read, while links stay available', () => {
    map({ restructureUnavailable: true })

    expect(screen.getByRole('button', { name: 'Split Packet A' })).toBeDisabled()
    expect(
      screen.getByRole('checkbox', { name: 'Choose Packet A to merge or move' }),
    ).toBeDisabled()
    expect(screen.getByText(/wait for the latest review/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'New lot from this: Stray photo' })).toBeEnabled()
  })

  it('shows evidence inherited from a split lot as such, without an unlink', () => {
    map({
      evidence: [file('f9', 'Old photo', ['gone'])] as unknown as MediaSnapshotDto['evidence'],
      predecessors: new Map([['c', ['gone']]]),
    })
    const photo = screen.getByRole('listitem', { name: /Old photo/ })

    expect(photo).toHaveTextContent('Bag via earlier lot')
    expect(photo).not.toHaveTextContent('Used by no lot')
    expect(within(photo).queryByRole('button', { name: /^Unlink/ })).not.toBeInTheDocument()
  })

  it('does not present a retired lot’s files as unused while the latest review is loading', () => {
    map({
      evidence: [
        file('f9', 'Old photo', ['gone']),
        file('f4', 'Stray photo', []),
      ] as unknown as MediaSnapshotDto['evidence'],
      retiredLotIds: new Set(['gone']),
      restructureUnavailable: true,
    })
    const old = screen.getByRole('listitem', { name: /Old photo/ })

    expect(old).toHaveTextContent('No lot yet · checking history')
    expect(old).not.toHaveTextContent('Used by no lot')
    expect(within(old).getByRole('button', { name: 'New lot from this: Old photo' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'New lot from this: Stray photo' })).toBeEnabled()
    expect(screen.getByRole('listitem', { name: /Stray photo/ })).toHaveTextContent(
      'Used by no lot',
    )
    // Packet A and B have no files here, but may inherit some once lineage is read.
    expect(screen.getByRole('listitem', { name: /Packet A/ })).toHaveTextContent(
      'No evidence yet · checking history',
    )
  })

  it('offers a direct link to a lot the file supports only through its Part', () => {
    map()
    const slip = screen.getByRole('listitem', { name: /Packing slip/ })
    const options = within(within(slip).getByLabelText('Link Packing slip to a lot'))
      .getAllByRole('option')
      .map((option) => option.textContent)

    expect(options).toEqual(['Link to a lot…', 'Packet A', 'Packet B', 'Bag'])
  })

  it('forgets a chosen lot once the file links to it, so Link cannot resend', async () => {
    const user = userEvent.setup()
    const props = {
      batch,
      evidence,
      retiredLotIds: new Set<string>(),
      disabled: false,
      link: vi.fn(async () => undefined),
      newLotFrom: vi.fn(async () => undefined),
      approvedLotIds: new Set<string>(),
      loading: false,
    }
    const view = render(<ReviewMap {...props} />)

    const stray = () => screen.getByRole('listitem', { name: /Stray photo/ })

    await user.selectOptions(within(stray()).getByLabelText('Link Stray photo to a lot'), 'c')
    await user.click(within(stray()).getByRole('button', { name: 'Link' }))

    const linked = [...evidence.slice(0, 3), file('f4', 'Stray photo', ['c'])]
    view.rerender(<ReviewMap {...props} evidence={linked as never} />)

    expect(within(stray()).getByLabelText('Link Stray photo to a lot')).toHaveValue('')
    expect(within(stray()).getByRole('button', { name: 'Link' })).toBeDisabled()
  })
})

describe('ReviewMap at region level', () => {
  it('lists each file’s observed regions with the lot each supports, and keeps file links', () => {
    const observed = {
      ...batch,
      evidence_observations: [
        {
          id: 'o1',
          evidence_version_id: 'v4',
          page: null,
          region: {
            kind: 'pixels',
            x: 0,
            y: 0,
            width: 1,
            height: 1,
            source_width: 9,
            source_height: 9,
          },
          readings: { markings: ['1N4148'], text: null },
          status: 'active',
          lot_id: 'c',
        },
        {
          id: 'o2',
          evidence_version_id: 'v4',
          page: null,
          region: {
            kind: 'pixels',
            x: 1,
            y: 1,
            width: 1,
            height: 1,
            source_width: 9,
            source_height: 9,
          },
          readings: { markings: [], text: null },
          status: 'active',
          lot_id: null,
        },
      ],
    } as unknown as CaptureSnapshotDto
    map({
      batch: observed,
      evidence: [
        { ...evidence[0], versions: [{ id: 'v1', evidence_id: 'f1' }] },
        { ...evidence[3], versions: [{ id: 'v4', evidence_id: 'f4' }] },
      ] as unknown as MediaSnapshotDto['evidence'],
    })
    const stray = screen.getByRole('listitem', { name: /Stray photo/ })

    expect(stray).not.toHaveTextContent('Used by no lot')
    const regions = within(stray).getByRole('list', { name: 'Regions of Stray photo' })
    expect(
      within(regions)
        .getAllByRole('listitem')
        .map((item) => item.textContent),
    ).toEqual(['1N4148 → Bag', 'Region 2 → no lot'])
    expect(
      within(screen.getByRole('listitem', { name: /Front label/ })).getByText('Packet A'),
    ).toBeInTheDocument()
    expect(screen.queryByRole('list', { name: 'Regions of Front label' })).not.toBeInTheDocument()
  })
})
