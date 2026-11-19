import { fireEvent, screen, waitFor } from '@testing-library/react'
import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import { expect, test, vi } from 'vitest'
import { render } from '#/test/render'
import { DevToolActions } from './DevToolActions'

function DraftWithRead({ read }: { read: () => Promise<string> }) {
  const [draft, setDraft] = useState('')
  const query = useQuery({ queryKey: ['fixture-read'], queryFn: read })

  return (
    <>
      <label>
        Lot quantity
        <input value={draft} onChange={(event) => setDraft(event.target.value)} />
      </label>
      <p>Read: {query.data}</p>
      <DevToolActions readiness={undefined} />
    </>
  )
}

test('Reload app data reads again from the server and keeps an unsaved draft', async () => {
  let count = 0
  const read = vi.fn(async () => {
    count += 1

    return `version ${count}`
  })
  render(<DraftWithRead read={read} />)
  await screen.findByText('Read: version 1')
  fireEvent.change(screen.getByLabelText('Lot quantity'), { target: { value: '12' } })

  fireEvent.click(screen.getByRole('button', { name: 'Reload app data' }))

  await screen.findByText('Read: version 2')
  expect(read).toHaveBeenCalledTimes(2)
  expect(screen.getByLabelText('Lot quantity')).toHaveValue('12')
  await waitFor(() =>
    expect(screen.getByRole('status')).toHaveTextContent('Reading everything again'),
  )
})
