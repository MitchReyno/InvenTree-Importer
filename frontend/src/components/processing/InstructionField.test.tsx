import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { expect, test, vi } from 'vitest'
import { InstructionField } from './InstructionField'

type Instruct = (text: string, revision: string, key: string) => Promise<unknown>

function renderField(text: string | undefined, instruct: Instruct = vi.fn(async () => undefined)) {
  const onDirtyChange = vi.fn()
  const props = { revision: '3', instruct, onDirtyChange }
  const view = render(<InstructionField {...props} text={text} />)

  const field = () => screen.getByLabelText('Instructions for the whole batch')

  return { ...view, props, onDirtyChange, instruct, field }
}

test('saved instructions that arrive after mount are shown', () => {
  const { field, props, rerender } = renderField(undefined)
  expect(screen.getByRole('status')).toHaveTextContent('Reading the saved instructions…')
  rerender(<InstructionField {...props} text="Keep packets apart." />)
  expect(field()).toHaveValue('Keep packets apart.')
})

test('a newer saved version is not taken while the operator is editing, but is after Discard', async () => {
  const user = userEvent.setup()
  const { field, props, rerender, onDirtyChange } = renderField('One')
  await user.type(field(), ' two')
  expect(onDirtyChange).toHaveBeenLastCalledWith(true)
  rerender(<InstructionField {...props} text="Changed elsewhere" />)
  expect(field()).toHaveValue('One two')
  await user.click(screen.getByRole('button', { name: 'Discard changes' }))
  expect(field()).toHaveValue('Changed elsewhere')
  expect(onDirtyChange).toHaveBeenLastCalledWith(false)
})

test('a confirmed save sends the draft and then follows the saved text again', async () => {
  const user = userEvent.setup()
  const { field, props, rerender, instruct, onDirtyChange } = renderField('One')
  await user.type(field(), ' two')
  rerender(<InstructionField {...props} text="One" />)
  await user.click(screen.getByRole('button', { name: 'Save instructions' }))
  expect(instruct).toHaveBeenCalledWith('One two', '3', expect.any(String))
  expect(onDirtyChange).toHaveBeenLastCalledWith(false)
  rerender(<InstructionField {...props} text="One two" />)
  expect(field()).toHaveValue('One two')
  rerender(<InstructionField {...props} text="Later" />)
  expect(field()).toHaveValue('Later')
})

test('a failed save keeps the draft and the guard', async () => {
  const user = userEvent.setup()
  const { field, onDirtyChange } = renderField(
    'One',
    vi.fn(async () => Promise.reject(new Error('down'))),
  )
  await user.type(field(), ' two')
  await user.click(screen.getByRole('button', { name: 'Save instructions' }))
  expect(await screen.findByRole('alert')).toHaveTextContent('Your draft is kept.')
  expect(field()).toHaveValue('One two')
  expect(onDirtyChange).toHaveBeenLastCalledWith(true)
})

test('leaving with a draft releases the guard', async () => {
  const user = userEvent.setup()
  const { field, onDirtyChange, unmount } = renderField('One')
  await user.type(field(), ' two')
  unmount()
  expect(onDirtyChange).toHaveBeenLastCalledWith(false)
})

test('typing back to the saved text follows later saved versions again', async () => {
  const user = userEvent.setup()
  const { field, props, rerender, onDirtyChange } = renderField('One')
  await user.type(field(), '!')
  await user.type(field(), '{Backspace}')
  expect(onDirtyChange).toHaveBeenLastCalledWith(false)
  rerender(<InstructionField {...props} text="Two" />)
  expect(field()).toHaveValue('Two')
  expect(onDirtyChange).toHaveBeenLastCalledWith(false)
})

test('saved text that catches up with the draft releases the guard', async () => {
  const user = userEvent.setup()
  const { field, props, rerender, onDirtyChange } = renderField('One')
  await user.type(field(), ' two')
  expect(onDirtyChange).toHaveBeenLastCalledWith(true)
  rerender(<InstructionField {...props} text="One two" />)
  expect(onDirtyChange).toHaveBeenLastCalledWith(false)
  rerender(<InstructionField {...props} text="Later" />)
  expect(field()).toHaveValue('Later')
})
