import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { expect, test, vi } from 'vitest'
import { AutoValueField, type AutoValue } from './AutoValueField'

function Harness({
  initial = { mode: 'auto' },
  type = 'text',
  disabled = false,
  onChange = () => undefined,
}: {
  initial?: AutoValue
  type?: 'text' | 'date'
  disabled?: boolean
  onChange?: (value: AutoValue) => void
}) {
  const [value, setValue] = useState(initial)
  return (
    <AutoValueField
      label={type === 'date' ? 'Purchase date' : 'Order number'}
      type={type}
      value={value}
      disabled={disabled}
      onChange={(next) => {
        setValue(next)
        onChange(next)
      }}
    />
  )
}

test('the trigger shows the current choice and keyboard opens radio-style choices', async () => {
  const user = userEvent.setup()
  render(<Harness />)
  const trigger = screen.getByRole('button', { name: 'Order number Auto Propose from evidence' })
  trigger.focus()
  await user.keyboard('{Enter}')
  const group = await screen.findByRole('radiogroup', { name: 'Order number' })
  expect(group).toBeVisible()
  expect(screen.getByRole('radio', { name: 'Auto' })).toBeChecked()
  expect(screen.getByRole('radio', { name: 'None' })).not.toBeChecked()
  expect(screen.queryByRole('textbox')).not.toBeInTheDocument()
})

test('Manual reveals a dedicated labelled input area and keeps the exact text', async () => {
  const user = userEvent.setup()
  const onChange = vi.fn()
  render(<Harness onChange={onChange} />)
  await user.click(screen.getByRole('button', { name: 'Order number Auto Propose from evidence' }))
  await user.click(screen.getByRole('radio', { name: 'Manual' }))
  const input = screen.getByRole('textbox', { name: 'Manual order number' })
  expect(input).toHaveFocus()
  await user.type(input, ' PO-0042 ')
  expect(onChange).toHaveBeenLastCalledWith({ mode: 'manual', value: ' PO-0042 ' })
  await user.keyboard('{Escape}')
  const trigger = screen.getByRole('button', { name: 'Order number Manual PO-0042' })
  expect(trigger).toHaveFocus()
  expect(screen.queryByRole('radiogroup')).not.toBeInTheDocument()
})

test('None and Auto replace a manual value without a text input inside an option', async () => {
  const user = userEvent.setup()
  const onChange = vi.fn()
  render(<Harness initial={{ mode: 'manual', value: 'R-1' }} onChange={onChange} />)
  await user.click(screen.getByRole('button', { name: 'Order number Manual R-1' }))
  for (const radio of screen.getAllByRole('radio')) {
    expect(radio.querySelector('input:not([type=radio])')).toBeNull()
  }
  await user.click(screen.getByRole('radio', { name: 'None' }))
  expect(onChange).toHaveBeenLastCalledWith({ mode: 'none' })
  expect(screen.queryByRole('textbox')).not.toBeInTheDocument()
})

test('the date variant uses a native calendar-date input', async () => {
  const user = userEvent.setup()
  const onChange = vi.fn()
  render(<Harness type="date" onChange={onChange} />)
  await user.click(screen.getByRole('button', { name: 'Purchase date Auto Propose from evidence' }))
  await user.click(screen.getByRole('radio', { name: 'Manual' }))
  const input = screen.getByLabelText('Manual purchase date')
  expect(input).toHaveAttribute('type', 'date')
  await user.type(input, '2026-11-03')
  expect(onChange).toHaveBeenLastCalledWith({ mode: 'manual', value: '2026-11-03' })
})

test('a disabled preview cannot open or change its value', async () => {
  const user = userEvent.setup()
  const onChange = vi.fn()
  render(<Harness disabled onChange={onChange} />)
  const trigger = screen.getByRole('button', { name: 'Order number Auto Propose from evidence' })
  expect(trigger).toBeDisabled()
  await user.click(trigger)
  expect(screen.queryByRole('radiogroup')).not.toBeInTheDocument()
  expect(onChange).not.toHaveBeenCalled()
})

test('the trigger is named by exactly what it shows: label, mode and hint or value', () => {
  const { unmount } = render(<Harness initial={{ mode: 'none' }} />)
  expect(screen.getByRole('button', { name: 'Order number None No value' })).toBeInTheDocument()
  unmount()
  render(<Harness initial={{ mode: 'manual', value: '  ' }} />)
  const trigger = screen.getByRole('button', { name: 'Order number Manual Not entered' })
  expect(trigger).toHaveTextContent('Order numberManualNot entered')
})
