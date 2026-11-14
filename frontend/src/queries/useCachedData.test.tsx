import { act, screen, waitFor } from '@testing-library/react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { expect, test, vi } from 'vitest'
import { render } from '#/test/render'
import { useCachedData } from './useCachedData'

const key = ['shared-read']

function Owner({ read }: { read: () => Promise<string> }) {
  useQuery({ queryKey: key, queryFn: read })
  return null
}

function Reader() {
  const value = useCachedData<string>(key)
  return <output aria-label="Cached">{value ?? 'none'}</output>
}

test('reading the cache leaves the owning read able to refresh', async () => {
  const read = vi.fn().mockResolvedValueOnce('first').mockResolvedValueOnce('second')
  let client: ReturnType<typeof useQueryClient> | undefined

  function Grab() {
    client = useQueryClient()
    return null
  }

  render(
    <>
      <Grab />
      <Owner read={read} />
      <Reader />
    </>,
  )
  await waitFor(() => expect(screen.getByLabelText('Cached')).toHaveTextContent('first'))

  await act(() => client!.invalidateQueries({ queryKey: key }))

  await waitFor(() => expect(screen.getByLabelText('Cached')).toHaveTextContent('second'))
  expect(read).toHaveBeenCalledTimes(2)
})

test('a failed refresh withholds the old data instead of passing it off as current', async () => {
  const read = vi.fn().mockResolvedValueOnce('first').mockRejectedValueOnce(new Error('offline'))
  let client: ReturnType<typeof useQueryClient> | undefined

  function Grab() {
    client = useQueryClient()
    return null
  }

  render(
    <>
      <Grab />
      <Owner read={read} />
      <Reader />
    </>,
  )
  await waitFor(() => expect(screen.getByLabelText('Cached')).toHaveTextContent('first'))

  await act(() => client!.invalidateQueries({ queryKey: key }))

  await waitFor(() => expect(screen.getByLabelText('Cached')).toHaveTextContent('none'))
})

test('an invalidated read with no owner left to refresh it is withheld', async () => {
  const read = vi.fn().mockResolvedValue('first')
  let client: ReturnType<typeof useQueryClient> | undefined

  function Grab() {
    client = useQueryClient()
    return null
  }

  const view = render(
    <>
      <Grab />
      <Owner read={read} />
      <Reader />
    </>,
  )
  await waitFor(() => expect(screen.getByLabelText('Cached')).toHaveTextContent('first'))
  view.rerender(
    <>
      <Grab />
      <Reader />
    </>,
  )

  await act(() => client!.invalidateQueries({ queryKey: key }))

  // Cache notices are batched, so the reader catches up a tick later.
  await waitFor(() => expect(screen.getByLabelText('Cached')).toHaveTextContent('none'))
  expect(read).toHaveBeenCalledOnce()
})

test('a query built while another component renders does not update the reader mid-render', async () => {
  const error = vi.spyOn(console, 'error').mockImplementation(() => {})
  let client: ReturnType<typeof useQueryClient> | undefined

  function Grab() {
    client = useQueryClient()
    return null
  }

  // A settled read whose notification is still pending, then a new query in the same render, as a
  // session drawer opening on first load does.
  function Builder() {
    const cache = client!.getQueryCache()
    const query = cache.build(client!, { queryKey: key })
    query.state = { ...query.state, status: 'success', data: 'settled', dataUpdatedAt: 1 }
    cache.build(client!, { queryKey: ['opened-in-render'] })
    return null
  }

  const view = render(
    <>
      <Grab />
      <Reader />
    </>,
  )
  view.rerender(
    <>
      <Grab />
      <Reader />
      <Builder />
    </>,
  )
  await waitFor(() => expect(screen.getByLabelText('Cached')).toHaveTextContent('settled'))
  expect(error.mock.calls.flat().join(' ')).not.toMatch(/Cannot update a component/)
  error.mockRestore()
})
