import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { StrictMode, useState } from 'react'
import { expect, test, vi } from 'vitest'
import { ChoicePicker, type PickerChoice } from './ChoicePicker'

const lots: PickerChoice[] = [
  { value: 'lot-1', label: 'LM358 op-amps' },
  { value: 'lot-2', label: '10k resistors · drawer 4' },
  { value: 'lot-3', label: 'NE555 timers', disabled: true },
  { value: '', label: 'No lot' },
]

function picker(props: Partial<Parameters<typeof ChoicePicker>[0]> = {}) {
  const onChange = vi.fn()
  render(
    <StrictMode>
      <ChoicePicker
        label="Move to"
        noun="lots"
        placeholder="Choose a lot…"
        choices={lots}
        value="lot-1"
        onChange={onChange}
        {...props}
      />
    </StrictMode>,
  )
  return { onChange, input: screen.getByRole('combobox', { name: props.label ?? 'Move to' }) }
}

const optionNames = () => screen.getAllByRole('option').map((option) => option.textContent)

test('shows the chosen value and lists every choice in order', async () => {
  const user = userEvent.setup()
  const { input } = picker()
  expect(screen.getByText('LM358 op-amps')).toBeVisible()
  await user.click(input)
  expect(optionNames()).toEqual([
    'LM358 op-amps',
    '10k resistors · drawer 4',
    'NE555 timers',
    'No lot',
  ])
})

test('search narrows the list by every typed word, in any case, and picks by value', async () => {
  const user = userEvent.setup()
  const { input, onChange } = picker()
  await user.type(input, 'DRAWER 10k')
  expect(optionNames()).toEqual(['10k resistors · drawer 4'])
  await user.keyboard('{Enter}')
  expect(onChange).toHaveBeenCalledExactlyOnceWith('lot-2')
})

test('a choice with an empty value is picked like any other', async () => {
  const user = userEvent.setup()
  const { input, onChange } = picker()
  await user.type(input, 'no lot')
  await user.click(screen.getByRole('option', { name: 'No lot' }))
  expect(onChange).toHaveBeenCalledExactlyOnceWith('')
})

test('a value no choice has shows the placeholder', () => {
  picker({ value: 'retired' })
  expect(screen.getByText('Choose a lot…')).toBeVisible()
})

test('no match says so with the noun', async () => {
  const user = userEvent.setup()
  const { input } = picker()
  await user.type(input, 'zzz')
  expect(screen.getByText('No lots match')).toBeVisible()
})

test('a disabled choice stays listed but cannot be picked', async () => {
  const user = userEvent.setup()
  const { input, onChange } = picker()
  await user.type(input, 'NE555')
  await user.click(screen.getByRole('option', { name: 'NE555 timers' }))
  expect(onChange).not.toHaveBeenCalled()
})

test('a disabled picker can’t be searched or opened', async () => {
  const user = userEvent.setup({ pointerEventsCheck: 0 })
  const { input } = picker({ disabled: true })
  expect(input).toBeDisabled()
  await user.click(input)
  expect(screen.queryByRole('listbox')).not.toBeInTheDocument()
})

test('a hidden label still names the picker', () => {
  picker({ label: 'Link photo 1 to a lot', labelHidden: true })
  expect(screen.getByRole('combobox', { name: 'Link photo 1 to a lot' })).toBeInTheDocument()
})

test('the status line describes the picker', () => {
  const { input } = picker({ status: 'Applies to this lot only.' })
  expect(input).toHaveAccessibleDescription('Applies to this lot only.')
})

test('typing a search is not a change to the enclosing form', async () => {
  const user = userEvent.setup()
  const formChange = vi.fn()
  render(
    <form onChange={formChange}>
      <ChoicePicker
        label="Move to"
        noun="lots"
        placeholder="Choose a lot…"
        choices={lots}
        value=""
        onChange={() => undefined}
      />
    </form>,
  )
  await user.type(screen.getByRole('combobox', { name: 'Move to' }), 'LM')
  expect(formChange).not.toHaveBeenCalled()
})

test('the input ref reaches the search field, so a caller can focus it', () => {
  function Focusing() {
    const [value, setValue] = useState('')
    return (
      <ChoicePicker
        label="Move to"
        noun="lots"
        placeholder="Choose a lot…"
        choices={lots}
        value={value}
        onChange={setValue}
        inputRef={(element) => element?.focus()}
      />
    )
  }

  render(<Focusing />)
  expect(screen.getByRole('combobox', { name: 'Move to' })).toHaveFocus()
})
