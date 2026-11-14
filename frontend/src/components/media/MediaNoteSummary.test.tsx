import { render, screen } from '@testing-library/react'
import { expect, it } from 'vitest'
import { MediaNoteSummary } from './MediaNoteSummary'

it('leaves out a missing save time rather than printing an invalid date', () => {
  render(
    <MediaNoteSummary
      title="Packing slip"
      note={{ id: 'n', version: 2, text: 'Two reels', actor_id: 'a' } as never}
    />,
  )
  expect(screen.getByText(/^Version 2/)).toHaveTextContent(/^Version 2$/)
  expect(screen.queryByText(/Invalid Date/)).toBeNull()
})
