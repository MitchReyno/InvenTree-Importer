import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { expect, test, vi } from 'vitest'
import { render } from '../../test/render'
import { CaptureActions } from './CaptureActions'

function renderActions(overrides: Partial<Parameters<typeof CaptureActions>[0]> = {}) {
  const props = {
    mediaDisabled: false,
    noteDisabled: false,
    takePhotos: vi.fn(),
    addDocument: vi.fn(),
    writeNote: vi.fn(),
    ...overrides,
  }
  render(<CaptureActions {...props} />)
  return props
}

test('names each capture tile by its action and describes it by its subline', () => {
  renderActions()

  expect(screen.getByRole('button', { name: 'Take photos' })).toHaveAccessibleDescription(
    'Camera or library',
  )
  expect(screen.getByRole('button', { name: 'Add document' })).toHaveAccessibleDescription(
    'Receipt, invoice, PDF',
  )
  expect(screen.getByRole('button', { name: 'Write a note' })).toHaveAccessibleDescription(
    'Or paste text',
  )
})

test('shows a decorative glyph on each tile', () => {
  renderActions()

  for (const name of ['Take photos', 'Add document', 'Write a note']) {
    const glyph = screen.getByRole('button', { name }).querySelector('[aria-hidden="true"]')
    expect(glyph).not.toBeNull()
    expect(glyph!.textContent).not.toBe('')
  }
})

test('runs each tile’s action and keeps a disabled tile inert', async () => {
  const props = renderActions({ noteDisabled: true })

  await userEvent.click(screen.getByRole('button', { name: 'Take photos' }))
  await userEvent.click(screen.getByRole('button', { name: 'Add document' }))
  expect(props.takePhotos).toHaveBeenCalledTimes(1)
  expect(props.addDocument).toHaveBeenCalledTimes(1)
  expect(screen.getByRole('button', { name: 'Write a note' })).toBeDisabled()
})
