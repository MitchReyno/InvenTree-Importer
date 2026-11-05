import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { KeyValue } from './KeyValue'
import { SourceChip } from './SourceChip'

describe('KeyValue', () => {
  it('states edited, override and inherited values in words', () => {
    render(
      <KeyValue
        rows={[
          { label: 'MPN', value: 'RC0603FR-0710KL', state: 'edited' },
          { label: 'Location', value: 'Drawer 4', state: 'override' },
          { label: 'Supplier', value: 'Mouser', state: 'inherited' },
        ]}
      />,
    )

    expect(screen.getByText('MPN')).toBeInTheDocument()
    expect(screen.getByText('RC0603FR-0710KL')).toBeInTheDocument()
    expect(screen.getByText('· overrides batch')).toBeInTheDocument()
    expect(screen.getByText('· from batch')).toBeInTheDocument()
    expect(screen.getByText('· edited')).toBeInTheDocument()
  })

  it('keeps the source chip outside the edit trigger', async () => {
    const onEdit = vi.fn()
    const onOpen = vi.fn()
    render(
      <KeyValue
        rows={[
          {
            label: 'Supplier',
            value: 'Mouser',
            state: 'plain',
            onEdit,
            source: <SourceChip source="Slip" certainty="Read" onOpen={onOpen} />,
          },
        ]}
      />,
    )
    const edit = screen.getByRole('button', { name: 'Edit Supplier: Mouser' })
    const chip = screen.getByRole('button', { name: 'Source: Slip, Read. Open evidence' })

    expect(edit).not.toContainElement(chip)
    await userEvent.click(chip)
    expect(onOpen).toHaveBeenCalledTimes(1)
    expect(screen.queryByRole('textbox', { name: 'Supplier' })).not.toBeInTheDocument()
  })

  it('edits in place: Enter saves and Escape cancels', async () => {
    const onEdit = vi.fn()
    render(<KeyValue rows={[{ label: 'Quantity', value: '100', state: 'plain', onEdit }]} />)

    await userEvent.click(screen.getByRole('button', { name: 'Edit Quantity: 100' }))
    const input = screen.getByRole('textbox', { name: 'Quantity' })
    expect(input).toHaveFocus()
    await userEvent.clear(input)
    await userEvent.type(input, '250{Enter}')
    expect(onEdit).toHaveBeenCalledWith('250')

    await userEvent.click(screen.getByRole('button', { name: 'Edit Quantity: 100' }))
    await userEvent.type(screen.getByRole('textbox', { name: 'Quantity' }), '9{Escape}')
    expect(onEdit).toHaveBeenCalledTimes(1)
    expect(screen.getByRole('button', { name: 'Edit Quantity: 100' })).toHaveFocus()
  })
})
