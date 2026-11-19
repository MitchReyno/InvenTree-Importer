import { fireEvent, screen } from '@testing-library/react'
import { expect, test } from 'vitest'
import { render } from '#/test/render'
import { CreationNotices } from './CreationNotices'

test('says which defaults a new batch could not copy, and can be dismissed', () => {
  render(
    <CreationNotices
      notices={[
        { field: 'location', code: 'default_not_found' },
        { field: 'supplier', code: 'default_unavailable' },
      ]}
    />,
  )
  const notice = screen.getByRole('status')
  expect(notice).toHaveTextContent(
    "The default location saved in Settings wasn't found in InvenTree, so this batch started without it.",
  )
  expect(notice).toHaveTextContent(
    "InvenTree couldn't be checked for the default supplier saved in Settings",
  )
  fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }))
  expect(screen.queryByRole('status')).not.toBeInTheDocument()
})

test('renders nothing when every default was copied', () => {
  render(<CreationNotices notices={[]} />)
  expect(screen.queryByRole('status')).not.toBeInTheDocument()
})
