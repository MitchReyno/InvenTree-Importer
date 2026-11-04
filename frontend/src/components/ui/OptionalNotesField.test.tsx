import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { expect, test, vi } from 'vitest'
import { OptionalNotesField } from './OptionalNotesField'

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
      <OptionalNotesField
        toggleLabel="Add batch notes"
        label="Batch notes"
        value={batch}
        onChange={(next) => {
          setBatch(next)
          onChange(next)
        }}
      />
      <OptionalNotesField
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
