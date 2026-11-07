import { act, screen, waitFor } from '@testing-library/react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { expect, test, vi } from 'vitest'
import { render } from '../test/render'
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

  expect(screen.getByLabelText('Cached')).toHaveTextContent('none')
  expect(read).toHaveBeenCalledOnce()
})
