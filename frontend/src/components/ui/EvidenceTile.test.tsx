import { fireEvent, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { EvidenceGroup } from './EvidenceGroup'
import { EvidenceTile } from './EvidenceTile'

const base = { name: 'IMG_2041.jpg', support: '1 lot', kind: 'photo' as const }

describe('EvidenceTile', () => {
  it('opens the viewer from the preview and selects from the tick', async () => {
    const onOpen = vi.fn()
    const onSelect = vi.fn()
    render(
      <EvidenceTile
        {...base}
        preview="/preview.jpg"
        state="ready"
        selectable
        selected={false}
        onOpen={onOpen}
        onSelect={onSelect}
      />,
    )

    await userEvent.click(screen.getByRole('button', { name: 'Open IMG_2041.jpg' }))
    expect(onOpen).toHaveBeenCalledTimes(1)
    await userEvent.click(screen.getByRole('checkbox', { name: 'Select IMG_2041.jpg' }))
    expect(onSelect).toHaveBeenCalledWith(true)
    expect(screen.getByText('1 lot')).toBeVisible()
  })

  it('shows a skeleton while preparing and one sentence with Retry when it failed', async () => {
    const onRetry = vi.fn()
    const { rerender } = render(<EvidenceTile {...base} state="preparing" onOpen={() => {}} />)
    expect(screen.getByText('Preparing…')).toBeVisible()

    rerender(<EvidenceTile {...base} state="failed" onOpen={() => {}} onRetry={onRetry} />)
    expect(screen.getByText('The preview couldn’t be made.')).toBeVisible()
    await userEvent.click(screen.getByRole('button', { name: 'Retry preview for IMG_2041.jpg' }))
    expect(onRetry).toHaveBeenCalledTimes(1)
  })

  it('falls back to the file name when a preview fails to load, per preview URL', () => {
    const { rerender } = render(
      <EvidenceTile {...base} preview="/missing.jpg" state="ready" onOpen={() => {}} />,
    )
    const image = screen.getByRole('button', { name: 'Open IMG_2041.jpg' }).querySelector('img')!

    fireEvent.error(image)
    expect(
      screen.getByRole('button', { name: 'Open IMG_2041.jpg' }).querySelector('img'),
    ).toBeNull()
    expect(screen.getAllByText('IMG_2041.jpg')).toHaveLength(2)

    rerender(<EvidenceTile {...base} preview="/replacement.jpg" state="ready" onOpen={() => {}} />)
    expect(
      screen.getByRole('button', { name: 'Open IMG_2041.jpg' }).querySelector('img'),
    ).toHaveAttribute('src', '/replacement.jpg')
  })

  it('shows the file name instead of a broken image and tags documents', () => {
    render(<EvidenceTile {...base} kind="document" state="ready" onOpen={() => {}} />)

    expect(screen.queryByRole('img')).not.toBeInTheDocument()
    expect(screen.getAllByText('IMG_2041.jpg').length).toBeGreaterThan(0)
    expect(screen.getByText('Document')).toBeInTheDocument()
  })
})

describe('EvidenceGroup', () => {
  it('renames the group inline and lists its tiles', async () => {
    const onRename = vi.fn()
    render(
      <EvidenceGroup name="Packet front and back" count={2} onRename={onRename}>
        <p>tiles</p>
      </EvidenceGroup>,
    )
    const name = screen.getByRole('textbox', { name: 'Group name' })

    await userEvent.clear(name)
    await userEvent.type(name, 'Resistor bag{Enter}')
    expect(onRename).toHaveBeenCalledWith('Resistor bag')
    expect(screen.getByRole('region', { name: 'Resistor bag' })).toHaveTextContent('2 files')
  })

  it('sends a rename once when Enter is followed by blur', async () => {
    const onRename = vi.fn()
    render(<EvidenceGroup name="Bag" count={1} onRename={onRename} />)
    const name = screen.getByRole('textbox', { name: 'Group name' })

    await userEvent.clear(name)
    await userEvent.type(name, 'New name{Enter}')
    await userEvent.tab()
    expect(onRename).toHaveBeenCalledTimes(1)
    expect(onRename).toHaveBeenCalledWith('New name')
  })

  it('lets the same rename be retried when the parent keeps the old name', async () => {
    const onRename = vi.fn()
    render(<EvidenceGroup name="Bag" count={1} onRename={onRename} />)
    const name = screen.getByRole('textbox', { name: 'Group name' })

    await userEvent.clear(name)
    await userEvent.type(name, 'New name{Enter}')
    await userEvent.type(name, '{Enter}')

    expect(onRename).toHaveBeenCalledTimes(2)
  })

  it('sends a later identical rename after the saved name changed back', async () => {
    const onRename = vi.fn()
    const { rerender } = render(<EvidenceGroup name="Bag" count={1} onRename={onRename} />)

    await userEvent.clear(screen.getByRole('textbox', { name: 'Group name' }))
    await userEvent.type(screen.getByRole('textbox', { name: 'Group name' }), 'New name{Enter}')
    rerender(<EvidenceGroup name="New name" count={1} onRename={onRename} />)
    rerender(<EvidenceGroup name="Bag" count={1} onRename={onRename} />)
    await userEvent.clear(screen.getByRole('textbox', { name: 'Group name' }))
    await userEvent.type(screen.getByRole('textbox', { name: 'Group name' }), 'New name{Enter}')

    expect(onRename).toHaveBeenCalledTimes(2)
  })

  it('restores the name on Escape and labels ungrouped files', async () => {
    const onRename = vi.fn()
    const { rerender } = render(<EvidenceGroup name="Bag" count={1} onRename={onRename} />)
    const name = screen.getByRole('textbox', { name: 'Group name' })

    await userEvent.type(name, 'X{Escape}')
    expect(name).toHaveValue('Bag')
    expect(onRename).not.toHaveBeenCalled()

    rerender(<EvidenceGroup name="Not grouped yet" count={3} ungrouped />)
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument()
    expect(screen.getByRole('region', { name: 'Not grouped yet' })).toHaveTextContent('3 files')
  })
})

describe('EvidenceGroup on Capture', () => {
  it('names its region and field, reports an unsaved name and locks the name while blocked', async () => {
    const onDraftChange = vi.fn()
    const { rerender } = render(
      <EvidenceGroup
        name="Bag"
        count={2}
        label="Bag · 2 files"
        nameLabel="Name for Bag"
        onRename={() => {}}
        onDraftChange={onDraftChange}
      />,
    )
    const field = screen.getByRole('textbox', { name: 'Name for Bag' })
    expect(screen.getByRole('region', { name: 'Bag · 2 files' })).toBeVisible()

    await userEvent.type(field, 'X')
    expect(onDraftChange).toHaveBeenLastCalledWith(true)
    await userEvent.type(field, '{Escape}')
    expect(onDraftChange).toHaveBeenLastCalledWith(false)

    rerender(
      <EvidenceGroup
        name="Bag"
        count={2}
        nameLabel="Name for Bag"
        nameDisabled
        onRename={() => {}}
      />,
    )
    expect(screen.getByRole('textbox', { name: 'Name for Bag' })).toBeDisabled()
  })
})

describe('EvidenceTile handle', () => {
  it('shows a move handle on the tile', () => {
    render(
      <EvidenceTile
        {...base}
        state="ready"
        onOpen={() => {}}
        handle={<button type="button">Drag IMG_2041.jpg</button>}
      />,
    )
    const tile = screen.getByRole('button', { name: 'Open IMG_2041.jpg' }).parentElement!
    expect(within(tile).getByRole('button', { name: 'Drag IMG_2041.jpg' })).toBeVisible()
  })
})

describe('EvidenceTile states', () => {
  it('shimmers while preparing and says so in the caption, not on the photo', () => {
    render(<EvidenceTile {...base} state="preparing" onOpen={() => {}} />)
    const stage = screen.getByRole('button', { name: 'Open IMG_2041.jpg' })

    expect(stage).not.toHaveTextContent('Preparing…')
    expect(screen.getByText('Preparing…').closest('[data-caption]')).not.toBeNull()
  })
})

describe('Evidence notes and lot counts', () => {
  it('adds the group’s lot count to its file count', () => {
    render(<EvidenceGroup name="Bag" count={2} meta="2 lots" />)
    expect(screen.getByRole('region', { name: 'Bag' })).toHaveTextContent('2 files · 2 lots')
  })

  it('offers a note link on the tile, worded by whether a note exists', async () => {
    const onNote = vi.fn()
    const { rerender } = render(
      <EvidenceTile {...base} state="ready" onOpen={() => {}} onNote={onNote} />,
    )
    await userEvent.click(screen.getByRole('button', { name: 'Note: IMG_2041.jpg' }))
    expect(onNote).toHaveBeenCalledTimes(1)

    rerender(
      <EvidenceTile
        {...base}
        note="Counted 30 Oct"
        state="ready"
        onOpen={() => {}}
        onNote={onNote}
      />,
    )
    expect(screen.getByRole('button', { name: 'Edit note: IMG_2041.jpg' })).toHaveTextContent(
      'Edit note',
    )
  })
})

describe('EvidenceGroup composition', () => {
  it('does not rename on the Enter that confirms an IME candidate', () => {
    const onRename = vi.fn()
    render(<EvidenceGroup name="Bag" count={1} onRename={onRename} />)
    const name = screen.getByRole('textbox', { name: 'Group name' })
    fireEvent.change(name, { target: { value: 'にほ' } })
    fireEvent.keyDown(name, { key: 'Enter', isComposing: true })
    expect(onRename).not.toHaveBeenCalled()
  })
})

describe('EvidenceGroup while its name is locked', () => {
  it('still lets an unsaved name be discarded', async () => {
    const onDraftChange = vi.fn()
    const { rerender } = render(
      <EvidenceGroup name="Bag" count={1} onRename={() => {}} onDraftChange={onDraftChange} />,
    )
    await userEvent.type(screen.getByRole('textbox', { name: 'Group name' }), 'X')
    rerender(
      <EvidenceGroup
        name="Bag"
        count={1}
        nameDisabled
        onRename={() => {}}
        onDraftChange={onDraftChange}
      />,
    )
    await userEvent.click(screen.getByRole('button', { name: 'Discard name change' }))
    expect(screen.getByRole('textbox', { name: 'Group name' })).toHaveValue('Bag')
    expect(onDraftChange).toHaveBeenLastCalledWith(false)
  })
})
