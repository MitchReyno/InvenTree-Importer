import { render, screen, within } from '@testing-library/react'
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

    await user.click(screen.getByRole('button', { name: 'New lot from Stray photo' }))
    expect(props.newLotFrom).toHaveBeenCalledWith('f4', 'Stray photo')
    expect(
      screen.queryByRole('button', { name: 'New lot from Front label' }),
    ).not.toBeInTheDocument()
  })

  it('offers split and merge through the existing commands', async () => {
    const user = userEvent.setup()
    const props = map()

    await user.click(screen.getByRole('button', { name: 'Split Bag' }))
    expect(props.openRestructure).toHaveBeenCalledWith('split', ['c'])

    await user.click(screen.getByRole('checkbox', { name: 'Choose Packet A to merge' }))
    await user.click(screen.getByRole('checkbox', { name: 'Choose Packet B to merge' }))
    await user.click(screen.getByRole('button', { name: 'Merge 2 lots' }))
    expect(props.openRestructure).toHaveBeenCalledWith('merge', ['a', 'b'])
  })

  it('has no instruction field before agent sessions exist, and says when evidence is unavailable', () => {
    map({ evidence: undefined })

    expect(screen.queryByRole('textbox')).not.toBeInTheDocument()
    expect(screen.getByText(/Evidence is unavailable/)).toBeInTheDocument()
  })
})
