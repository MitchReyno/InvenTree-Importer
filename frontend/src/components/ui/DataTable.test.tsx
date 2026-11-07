import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { BulkBar } from './BulkBar'
import { DataTable } from './DataTable'

const columns = [
  { id: 'name', header: 'Lot' },
  { id: 'mpn', header: 'MPN', mono: true, editable: true },
  { id: 'qty', header: 'Quantity', editable: true },
]
const rows = [
  {
    id: 'l1',
    label: 'Resistor bag',
    cells: {
      name: { value: 'Resistor bag' },
      mpn: { value: 'RC0603', edited: true },
      qty: { value: '100', override: true },
    },
  },
  {
    id: 'l2',
    label: 'Caps',
    cells: { name: { value: 'Caps' }, mpn: { value: 'GRM188' }, qty: { value: '50' } },
  },
]

describe('DataTable', () => {
  it('selects rows and marks the selected ones', async () => {
    const onToggle = vi.fn()
    const onToggleAll = vi.fn()
    render(
      <DataTable
        caption="Lots"
        columns={columns}
        rows={rows}
        selection={{ selected: new Set(['l1']), onToggle, onToggleAll }}
      />,
    )

    expect(screen.getByRole('checkbox', { name: 'Select Resistor bag' })).toBeChecked()
    expect(screen.getByRole('checkbox', { name: 'Select all rows' })).toHaveProperty(
      'indeterminate',
      true,
    )
    await userEvent.click(screen.getByRole('checkbox', { name: 'Select Caps' }))
    expect(onToggle).toHaveBeenCalledWith('l2')
    await userEvent.click(screen.getByRole('checkbox', { name: 'Select all rows' }))
    expect(onToggleAll).toHaveBeenCalledTimes(1)
  })

  it('marks overrides and edits in words and edits a cell in place', async () => {
    const onCellEdit = vi.fn()
    render(<DataTable caption="Lots" columns={columns} rows={rows} onCellEdit={onCellEdit} />)
    const first = screen.getAllByRole('row')[1]

    expect(within(first).getByText('overrides batch')).toBeInTheDocument()
    expect(within(first).getByText('edited')).toBeInTheDocument()
    await userEvent.click(within(first).getByRole('button', { name: 'Edit Quantity: 100' }))
    await userEvent.type(screen.getByRole('textbox', { name: 'Quantity' }), '0{Enter}')
    expect(onCellEdit).toHaveBeenCalledWith('l1', 'qty', '1000')
  })

  it('keeps a nowrap column on one line, so a short word never breaks', () => {
    render(
      <DataTable
        caption="Sessions"
        columns={[
          { id: 'step', header: 'Step', nowrap: true },
          { id: 'status', header: 'Status' },
        ]}
        rows={[
          {
            id: 's',
            label: 'Research',
            cells: { step: { value: 'Research' }, status: { value: 'Long text' } },
          },
        ]}
      />,
    )

    expect(screen.getByRole('cell', { name: 'Research' })).toHaveAttribute('data-nowrap', 'true')
    expect(screen.getByRole('cell', { name: 'Long text' })).not.toHaveAttribute('data-nowrap')
  })
})

describe('BulkBar', () => {
  it('states its scope and applies a value to the selection', async () => {
    const onApply = vi.fn()
    const onClear = vi.fn()
    render(<BulkBar count={3} field="Location" onApply={onApply} onClear={onClear} />)
    const bar = screen.getByRole('region', { name: 'Bulk edit' })

    expect(bar).toHaveTextContent('3 selected')
    await userEvent.type(within(bar).getByRole('textbox', { name: 'Location' }), 'Drawer 2')
    await userEvent.click(within(bar).getByRole('button', { name: 'Apply to 3' }))
    expect(onApply).toHaveBeenCalledWith('Drawer 2', 'Location')
    await userEvent.click(within(bar).getByRole('button', { name: 'Clear selection' }))
    expect(onClear).toHaveBeenCalledTimes(1)
  })
})

describe('BulkBar without a field', () => {
  it('carries only the selection actions', async () => {
    const onClear = vi.fn()
    render(
      <BulkBar count={2} onClear={onClear} extraActions={<button type="button">Merge</button>} />,
    )
    const bar = screen.getByRole('region', { name: 'Bulk edit' })
    expect(bar).toHaveTextContent('2 selected')
    expect(within(bar).queryByRole('textbox')).toBeNull()
    expect(within(bar).queryByRole('button', { name: /Apply/ })).toBeNull()
    await userEvent.click(within(bar).getByRole('button', { name: 'Clear selection' }))
    expect(onClear).toHaveBeenCalledTimes(1)
  })
})

describe('DataTable region and disabled selection', () => {
  it('names a keyboard-scrollable region and locks the checkboxes while disabled', () => {
    render(
      <DataTable
        caption="Lots"
        region="Lot table"
        columns={[{ id: 'name', header: 'Name' }]}
        rows={[{ id: 'a', label: 'Packet A', cells: { name: { value: 'Packet A' } } }]}
        selection={{
          selected: new Set(),
          onToggle: () => {},
          onToggleAll: () => {},
          disabled: true,
        }}
      />,
    )
    expect(screen.getByRole('region', { name: 'Lot table' })).toHaveAttribute('tabindex', '0')
    expect(screen.getByRole('checkbox', { name: 'Select Packet A' })).toBeDisabled()
    expect(screen.getByRole('checkbox', { name: 'Select all rows' })).toBeDisabled()
  })
})

describe('BulkBar with several fields', () => {
  it('chooses the field, applies its value and clears', async () => {
    const onApply = vi.fn()
    render(
      <BulkBar count={2} field={['Quantity', 'Location']} onApply={onApply} onClear={() => {}} />,
    )
    const bar = screen.getByRole('region', { name: 'Bulk edit' })
    await userEvent.selectOptions(within(bar).getByRole('combobox', { name: 'Field' }), 'Location')
    await userEvent.type(within(bar).getByRole('textbox', { name: 'Location' }), 'Drawer 2')
    await userEvent.click(within(bar).getByRole('button', { name: 'Apply to 2' }))
    expect(onApply).toHaveBeenCalledWith('Drawer 2', 'Location')
    expect(within(bar).getByRole('button', { name: 'Clear selection' })).toHaveTextContent(
      /^Clear$/,
    )
  })
})
