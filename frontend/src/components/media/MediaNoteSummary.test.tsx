import { render, screen } from '@testing-library/react'
import { afterEach, expect, it } from 'vitest'
import { setDebugMode } from '#/test/debug-mode'
import { MediaNoteSummary } from './MediaNoteSummary'

afterEach(() => setDebugMode(false))

it('leaves out a missing save time rather than printing an invalid date', () => {
  render(
    <MediaNoteSummary
      title="Packing slip"
      note={{ id: 'n', version: 2, text: 'Two reels', actor_id: 'a' } as never}
    />,
  )
  expect(screen.queryByText(/^Saved/)).toBeNull()
  expect(screen.queryByText(/Invalid Date/)).toBeNull()
})

it('keeps the version and provenance for debug mode', () => {
  const note = { id: 'n', version: 2, text: 'Two reels', actor_id: 'a' } as never
  const { rerender } = render(<MediaNoteSummary title="Packing slip" note={note} />)
  expect(screen.queryByText('2')).toBeNull()

  setDebugMode(true)
  rerender(<MediaNoteSummary title="Packing slip" note={note} />)

  const block = screen.getByRole('group', { name: 'Debug: Note provenance' })
  expect(block).toHaveTextContent('Version2')
  expect(block).toHaveTextContent('Recordn')
})
