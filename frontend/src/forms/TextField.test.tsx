import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { expect, test, vi } from 'vitest'
import { NotesField, TextField } from './TextField'

function Harness({
  initial = null,
  onChange = () => undefined,
}: {
  initial?: string | null
  onChange?: (value: string | null) => void
}) {
  const [batch, setBatch] = useState(initial)
  const [order, setOrder] = useState<string | null>('Deliver to bench')
  return (
    <>
      <NotesField
        toggleLabel="Add batch notes"
        label="Batch notes"
        value={batch}
        onChange={(next) => {
          setBatch(next)
          onChange(next)
        }}
      />
      <NotesField
        toggleLabel="Add order notes"
        label="Order notes"
        value={order}
        onChange={setOrder}
      />
    </>
  )
}

test('Add batch notes reveals multiline text and Hide keeps it without a change', async () => {
  const user = userEvent.setup()
  const onChange = vi.fn()
  render(<Harness onChange={onChange} />)
  const toggle = screen.getByRole('checkbox', { name: 'Add batch notes' })
  expect(toggle).not.toBeChecked()
  expect(screen.queryByRole('textbox', { name: 'Batch notes' })).not.toBeInTheDocument()
  await user.click(toggle)
  const notes = screen.getByRole('textbox', { name: 'Batch notes' })
  expect(notes.tagName).toBe('TEXTAREA')
  await user.type(notes, 'Two packets{Enter}one reel')
  expect(onChange).toHaveBeenLastCalledWith('Two packets\none reel')
  onChange.mockClear()
  await user.click(toggle)
  expect(onChange).not.toHaveBeenCalled()
  expect(screen.queryByRole('textbox', { name: 'Batch notes' })).not.toBeInTheDocument()
  expect(screen.getByText('Hidden batch notes are kept (20 characters).')).toBeVisible()
  await user.click(toggle)
  expect(screen.getByRole('textbox', { name: 'Batch notes' })).toHaveValue('Two packets\none reel')
})

test('Remove retires the current text instead of hiding it', async () => {
  const user = userEvent.setup()
  const onChange = vi.fn()
  render(<Harness initial="Saved note" onChange={onChange} />)
  expect(screen.getByRole('checkbox', { name: 'Add batch notes' })).toBeChecked()
  await user.click(screen.getByRole('button', { name: 'Remove batch notes' }))
  expect(onChange).toHaveBeenLastCalledWith(null)
  expect(screen.queryByRole('textbox', { name: 'Batch notes' })).not.toBeInTheDocument()
  expect(screen.queryByText(/Hidden batch notes/)).not.toBeInTheDocument()
})

test('separate scopes keep independent text', async () => {
  const user = userEvent.setup()
  render(<Harness initial="Batch text" />)
  await user.click(screen.getByRole('button', { name: 'Remove batch notes' }))
  expect(screen.getByRole('textbox', { name: 'Order notes' })).toHaveValue('Deliver to bench')
})

test('labels its control and describes it with the help text', () => {
  render(<TextField label="Quantity" help="Count or weigh." placeholder="e.g. 500" />)
  const input = screen.getByRole('textbox', { name: 'Quantity' })

  expect(input).toHaveAccessibleDescription('Count or weigh.')
  expect(input).not.toHaveAttribute('aria-invalid')
})

test('shows an error in place of the help and marks the control invalid', () => {
  render(
    <TextField label="Quantity" help="Count or weigh." error="Enter a whole number of parts." />,
  )
  const input = screen.getByRole('textbox', { name: 'Quantity' })

  expect(input).toHaveAttribute('aria-invalid', 'true')
  expect(input).toHaveAccessibleDescription('Enter a whole number of parts.')
  expect(screen.queryByText('Count or weigh.')).not.toBeInTheDocument()
})

test('renders a select or a textarea with the same label and help', () => {
  render(
    <>
      <TextField as="select" label="Location" help="Where the stock goes." defaultValue="b3">
        <option value="b3">Bench bin B3</option>
      </TextField>
      <TextField as="textarea" label="Notes for the whole batch" />
    </>,
  )

  expect(screen.getByRole('combobox', { name: 'Location' })).toHaveAccessibleDescription(
    'Where the stock goes.',
  )
  expect(screen.getByRole('textbox', { name: 'Notes for the whole batch' })).toBeInTheDocument()
})

test('a caller’s invalid state and description are kept, with the help added', () => {
  render(
    <>
      <p id="server-error">The server refused this title.</p>
      <TextField
        label="Title"
        help="Shown on the batch list."
        aria-invalid={true}
        aria-describedby="server-error"
      />
    </>,
  )
  const field = screen.getByRole('textbox', { name: 'Title' })
  expect(field).toHaveAttribute('aria-invalid', 'true')
  expect(field).toHaveAccessibleDescription(
    'The server refused this title. Shown on the batch list.',
  )
})
