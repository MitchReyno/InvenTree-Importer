import { fireEvent, screen, waitFor } from '@testing-library/react'
import { useQuery } from '@tanstack/react-query'
import { afterEach, expect, test, vi } from 'vitest'
import { serverQueryKey } from '#/queries/scope'
import { setDebugMode } from '#/test/debug-mode'
import { fixtureScope, render } from '#/test/render'
import { PageDebugPanel } from './PageDebugPanel'

const batchId = 'b0000000-0000-4000-8000-000000000001'

function RecordsScreen({ read }: { read: () => Promise<string> }) {
  const records = useQuery({
    queryKey: serverQueryKey(fixtureScope, 'records', batchId),
    queryFn: read,
    retry: false,
  })

  return (
    <>
      <button type="button" onClick={() => void records.refetch()}>
        Refresh records
      </button>
      <PageDebugPanel route={`${batchId}/review/records`} batchId={batchId} />
    </>
  )
}

afterEach(() => setDebugMode(false))

test('the page panel is absent while debug mode is off', async () => {
  const read = vi.fn(async () => 'records')
  render(<RecordsScreen read={read} />)
  await waitFor(() => expect(read).toHaveBeenCalledTimes(1))

  expect(screen.queryByText(/^Debug ·/)).toBeNull()
})

test('a failed read shows as failed with the age of its data, and opening sends nothing', async () => {
  let fail = false
  const read = vi.fn(async () => {
    if (fail) {
      throw new Error('offline')
    }

    return 'records'
  })
  render(<RecordsScreen read={read} />)
  await waitFor(() => expect(read).toHaveBeenCalledTimes(1))
  fail = true
  fireEvent.click(screen.getByRole('button', { name: 'Refresh records' }))
  await waitFor(() => expect(read).toHaveBeenCalledTimes(2))

  setDebugMode(true)
  fireEvent.click(screen.getByText('Debug · review › records'))

  const panel = screen.getByText('Debug · review › records').closest('details')!
  await waitFor(() => expect(panel).toHaveTextContent(`records/${batchId}failed · data`))
  expect(panel).toHaveTextContent(`Route#${batchId}/review/records`)
  expect(panel).toHaveTextContent(`Batch${batchId}`)
  expect(read).toHaveBeenCalledTimes(2)
})
