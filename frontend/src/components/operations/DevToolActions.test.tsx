import { fireEvent, screen, waitFor } from '@testing-library/react'
import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import { expect, test, vi } from 'vitest'
import { useReportDirty } from '#/navigation/useReportDirty'
import { render } from '#/test/render'
import { DevToolActions } from './DevToolActions'

type DraftProps = {
  read: () => Promise<string>
  onDirtyChange: (dirty: boolean) => void
}

/** An editor fed by a read, reporting its draft to the navigation guard as the app's forms do. */
function DraftWithRead({ read, onDirtyChange }: DraftProps) {
  const query = useQuery({ queryKey: ['fixture-read'], queryFn: read })
  const [draft, setDraft] = useState<string | null>(null)
  const dirty = draft !== null
  useReportDirty(dirty, onDirtyChange)

  return (
    <>
      <label>
        Lot quantity
        <input
          value={draft ?? query.data ?? ''}
          onChange={(event) => {
            setDraft(event.target.value)
            onDirtyChange(true)
          }}
        />
      </label>
      <p>Read: {query.data}</p>
      <DevToolActions readiness={undefined} />
    </>
  )
}

test('Reload app data reads again and keeps an unsaved draft guarded', async () => {
  let count = 0
  const read = vi.fn(async () => {
    count += 1

    return `${count * 10}`
  })
  const onDirtyChange = vi.fn()
  render(<DraftWithRead read={read} onDirtyChange={onDirtyChange} />)
  await screen.findByText('Read: 10')
  fireEvent.change(screen.getByLabelText('Lot quantity'), { target: { value: '12' } })
  onDirtyChange.mockClear()

  fireEvent.click(screen.getByRole('button', { name: 'Reload app data' }))

  await screen.findByText('Read: 20')
  expect(read).toHaveBeenCalledTimes(2)
  expect(screen.getByLabelText('Lot quantity')).toHaveValue('12')
  expect(onDirtyChange).not.toHaveBeenCalledWith(false)
  await waitFor(() =>
    expect(screen.getByRole('status')).toHaveTextContent('Reading everything again'),
  )
})
