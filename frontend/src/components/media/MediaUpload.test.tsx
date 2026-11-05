import { fireEvent, screen } from '@testing-library/react'
import { expect, test, vi } from 'vitest'
import { render } from '../../test/render'
import { MediaUpload } from './MediaUpload'

function props(disabled: boolean) {
  return {
    disabled,
    chooseDisabled: disabled,
    noteDisabled: false,
    revision: '1',
    onDirtyChange: vi.fn(),
    upload: vi.fn(),
    finish: vi.fn(),
  }
}

// The picker returns focus, which briefly re-reads the batch; the chosen file arrives in that window.
test('keeps a photo chosen while uploads are briefly unavailable', () => {
  const view = render(<MediaUpload {...props(true)} />)
  const photo = new File(['jpeg'], 'bench.jpg', { type: 'image/jpeg' })

  fireEvent.change(screen.getByLabelText('Choose photos'), { target: { files: [photo] } })

  expect(screen.getByText('Selected: bench.jpg')).toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Retain bench.jpg' })).toBeDisabled()

  view.rerender(<MediaUpload {...props(false)} />)
  expect(screen.getByRole('button', { name: 'Retain bench.jpg' })).toBeEnabled()
})
