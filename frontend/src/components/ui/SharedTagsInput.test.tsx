import { fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Profiler, useState } from 'react'
import { expect, test, vi } from 'vitest'
import { SharedTagsInput, type SharedTags } from './SharedTagsInput'

function Harness({
  initial = { manual: [], auto: false },
  onChange = () => undefined,
}: {
  initial?: SharedTags
  onChange?: (value: SharedTags) => void
}) {
  const [value, setValue] = useState(initial)
  return (
    <SharedTagsInput
      value={value}
      onChange={(next) => {
        setValue(next)
        onChange(next)
      }}
    />
  )
}

test('Enter and comma add trimmed manual tags and Auto stays independent', async () => {
  const user = userEvent.setup()
  const onChange = vi.fn()
  render(<Harness onChange={onChange} />)
  const input = screen.getByRole('textbox', { name: 'Add shared part tag' })
  await user.type(input, ' bench {Enter}receipt,')
  expect(onChange).toHaveBeenLastCalledWith({ manual: ['bench', 'receipt'], auto: false })
  expect(input).toHaveValue('')
  await user.click(screen.getByRole('checkbox', { name: 'Also suggest tags automatically' }))
  expect(onChange).toHaveBeenLastCalledWith({ manual: ['bench', 'receipt'], auto: true })
  await user.click(screen.getByRole('button', { name: 'Remove tag bench' }))
  expect(onChange).toHaveBeenLastCalledWith({ manual: ['receipt'], auto: true })
})

test('Auto can be enabled with no manual tags', async () => {
  const user = userEvent.setup()
  const onChange = vi.fn()
  render(<Harness onChange={onChange} />)
  await user.click(screen.getByRole('checkbox', { name: 'Also suggest tags automatically' }))
  expect(onChange).toHaveBeenLastCalledWith({ manual: [], auto: true })
})

test('a case-insensitive duplicate keeps the original tag and explains why', async () => {
  const user = userEvent.setup()
  const onChange = vi.fn()
  render(<Harness initial={{ manual: ['Bench'], auto: false }} onChange={onChange} />)
  const input = screen.getByRole('textbox', { name: 'Add shared part tag' })
  await user.type(input, 'bench{Enter}')
  expect(onChange).not.toHaveBeenCalled()
  expect(screen.getByText('“Bench” is already a tag.')).toBeVisible()
  expect(input).toHaveValue('bench')
})

test('the tag limits are enforced before a change is emitted', async () => {
  const onChange = vi.fn()
  const full = Array.from({ length: 32 }, (_, index) => `t${index}`)
  render(<Harness initial={{ manual: full, auto: false }} onChange={onChange} />)
  const input = screen.getByRole('textbox', { name: 'Add shared part tag' })
  expect(input).toBeDisabled()
  expect(screen.getByText('32 of 32 tags')).toBeVisible()
})

test('Enter during IME composition does not add a partial tag; Backspace never removes chips', async () => {
  const user = userEvent.setup()
  const onChange = vi.fn()
  render(<Harness initial={{ manual: ['keep'], auto: false }} onChange={onChange} />)
  const input = screen.getByRole('textbox', { name: 'Add shared part tag' })
  fireEvent.change(input, { target: { value: 'でん' } })
  fireEvent.keyDown(input, { key: 'Enter', isComposing: true })
  expect(onChange).not.toHaveBeenCalled()
  await user.clear(input)
  await user.type(input, '{Backspace}')
  expect(onChange).not.toHaveBeenCalled()
})

test('a comma typed during IME composition waits for the composition to end', () => {
  const onChange = vi.fn()
  render(<Harness onChange={onChange} />)
  const input = screen.getByRole('textbox', { name: 'Add shared part tag' })
  fireEvent.compositionStart(input)
  fireEvent.change(input, { target: { value: '抵抗,' } })
  expect(onChange).not.toHaveBeenCalled()
  expect(input).toHaveValue('抵抗,')
  fireEvent.compositionEnd(input)
  expect(onChange).toHaveBeenLastCalledWith({ manual: ['抵抗'], auto: false })
  expect(input).toHaveValue('')
})

test('pending text is reported from the input event, before the next render commits', () => {
  const log: string[] = []

  function Ordered() {
    const [value, setValue] = useState<SharedTags>({ manual: [], auto: false })
    return (
      <Profiler id="tags" onRender={() => log.push('commit')}>
        <SharedTagsInput
          value={value}
          onChange={setValue}
          onPendingChange={(pending) => log.push(`pending:${pending}`)}
        />
      </Profiler>
    )
  }

  render(<Ordered />)
  log.length = 0
  fireEvent.change(screen.getByRole('textbox', { name: 'Add shared part tag' }), {
    target: { value: 'b' },
  })
  expect(log[0]).toBe('pending:true')
})
