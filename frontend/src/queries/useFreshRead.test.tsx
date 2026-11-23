import { act, screen, waitFor } from '@testing-library/react'
import { onlineManager, QueryClient, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { expect, test, vi } from 'vitest'
import { render } from '#/test/render'
import { ServerStateProvider } from '#/components/query/ServerStateProvider'
import { cancelVerified, freshReads } from './fresh-reads'
import { useFreshRead, type FreshRead } from './useFreshRead'

const key = ['intake', 'fixture', 'processing']

/** A read the test settles by hand. */
function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<T>((done, fail) => {
    resolve = done
    reject = fail
  })
  return { promise, resolve, reject }
}

/** Reads answered in order, each settled by the test. */
function scriptedReads<T>() {
  const pending: ReturnType<typeof deferred<T>>[] = []
  const read = vi.fn(() => {
    const next = deferred<T>()
    pending.push(next)
    return next.promise
  })
  return { read, pending }
}

let client: QueryClient | undefined

function Grab() {
  client = useQueryClient()
  return null
}

function Observer({
  name,
  read,
  current,
  restored,
  interval = false,
}: {
  name: string
  read: () => Promise<{ value: string }>
  current?: (data: { value: string }) => boolean
  restored?: { value: string }
  interval?: number | false
}) {
  const fresh = useFreshRead({
    queryKey: key,
    queryFn: read,
    current,
    restored,
    refetchInterval: interval,
  })
  return <Report name={name} fresh={fresh} />
}

function Report({ name, fresh }: { name: string; fresh: FreshRead<{ value: string }> }) {
  return (
    <output aria-label={name}>
      {[
        fresh.phase,
        fresh.verified ? 'verified' : 'unverified',
        fresh.settledAfterHint ? 'after-hint' : 'before-hint',
        fresh.data?.value ?? 'none',
      ].join(' ')}
    </output>
  )
}

function state(name: string) {
  return screen.getByLabelText(name).textContent ?? ''
}

test('only a read this observer saw start verifies it, even with equal data', async () => {
  const { read, pending } = scriptedReads<{ value: string }>()
  render(
    <>
      <Grab />
      <Observer name="A" read={read} />
    </>,
  )
  // Another view's write before the read lands is not a verified read.
  await act(() => client!.setQueryData(key, { value: 'written' }))
  expect(state('A')).toContain('unverified')

  await act(async () => pending[0].resolve({ value: 'written' }))
  await waitFor(() => expect(state('A')).toBe('current verified after-hint written'))

  // A write after verification clears it, even when it writes equal data.
  await act(() => client!.setQueryData(key, { value: 'written' }))
  expect(state('A')).toBe('cached unverified before-hint written')
})

test('a receipt writer’s reread verifies its observers again', async () => {
  const { read, pending } = scriptedReads<{ value: string }>()
  render(
    <>
      <Grab />
      <Observer name="A" read={read} />
    </>,
  )
  await act(async () => pending[0].resolve({ value: 'one' }))
  await waitFor(() => expect(state('A')).toContain(' verified'))

  await act(() => client!.setQueryData(key, { value: 'receipt' }))
  expect(state('A')).toContain('unverified')
  act(() => {
    void client!.invalidateQueries({ queryKey: key })
  })
  await waitFor(() => expect(pending).toHaveLength(2))
  await act(async () => pending[1].resolve({ value: 'receipt' }))
  await waitFor(() => expect(state('A')).toBe('current verified after-hint receipt'))
})

test('a silent cancel and replace never verifies the cancelled request, and keeps the adopted read', async () => {
  const { read, pending } = scriptedReads<{ value: string }>()
  render(
    <>
      <Grab />
      <Observer name="A" read={read} />
    </>,
  )
  await act(async () => pending[0].resolve({ value: 'one' }))
  await waitFor(() => expect(state('A')).toContain(' verified'))

  // A background refresh starts; reconciliation cancels it and reads again.
  act(() => {
    void client!.refetchQueries({ queryKey: key })
  })
  await waitFor(() => expect(pending).toHaveLength(2))
  await act(async () => {
    await cancelVerified(client!, { queryKey: key }, { silent: true })
    void client!.invalidateQueries({ queryKey: key })
  })
  await waitFor(() => expect(pending).toHaveLength(3))
  // The adopted read survives the cancel, so commands with a revision stay available through the
  // refresh; commands with none wait for it to settle.
  expect(state('A')).toBe('refreshing verified before-hint one')

  await act(async () => pending[1].resolve({ value: 'cancelled' }))
  expect(state('A')).toContain('one')
  await act(async () => pending[2].resolve({ value: 'replacement' }))
  await waitFor(() => expect(state('A')).toBe('current verified after-hint replacement'))
})

test('reconciliation keeps a settled read verified and never adopts the cancelled refresh', async () => {
  const processing = scriptedReads<{ value: string }>()
  const review = scriptedReads<{ value: string }>()
  const reviewKey = ['intake', 'fixture', 'manual']

  function ReviewObserver() {
    const fresh = useFreshRead({ queryKey: reviewKey, queryFn: review.read })
    return <Report name="Review" fresh={fresh} />
  }

  render(
    <>
      <Grab />
      <Observer name="A" read={processing.read} />
      <ReviewObserver />
    </>,
  )
  await act(async () => processing.pending[0].resolve({ value: 'p1' }))
  await act(async () => review.pending[0].resolve({ value: 'r1' }))
  await waitFor(() => expect(state('Review')).toContain(' verified'))

  // Review refreshes in the background; Processing has settled.
  act(() => {
    void client!.refetchQueries({ queryKey: reviewKey })
  })
  await waitFor(() => expect(review.pending).toHaveLength(2))
  await act(async () => {
    await cancelVerified(client!, { queryKey: ['intake', 'fixture'] }, { silent: true })
  })
  expect(state('A')).toContain(' verified')
  expect(state('Review')).toContain(' verified')

  // The cancelled refresh lands with no replacement started: it is never adopted.
  await act(async () => review.pending[1].resolve({ value: 'r2-cancelled' }))
  expect(state('Review')).toContain('r1')
})

test('an observer that joins a running read is verified only after the single follow-up fetch', async () => {
  const { read, pending } = scriptedReads<{ value: string }>()

  function Pair() {
    const [second, setSecond] = useState(false)
    return (
      <>
        <Observer name="A" read={read} />
        <button onClick={() => setSecond(true)}>Mount B</button>
        {second && <Observer name="B" read={read} />}
      </>
    )
  }

  render(
    <>
      <Grab />
      <Pair />
    </>,
  )
  await waitFor(() => expect(pending).toHaveLength(1))
  act(() => screen.getByRole('button', { name: 'Mount B' }).click())
  // B's mount fetch joins A's request rather than starting its own.
  expect(read).toHaveBeenCalledTimes(1)

  await act(async () => pending[0].resolve({ value: 'joined' }))
  await waitFor(() => expect(state('A')).toContain(' verified'))
  expect(state('B')).toContain('unverified')

  await waitFor(() => expect(pending).toHaveLength(2))
  await act(async () => pending[1].resolve({ value: 'follow-up' }))
  await waitFor(() => expect(state('B')).toBe('current verified after-hint follow-up'))
  // One follow-up, and nothing after it: polling is off.
  await act(async () => {
    await new Promise((settle) => setTimeout(settle, 20))
  })
  expect(read).toHaveBeenCalledTimes(2)
})

test('a shared read verifies every observer mounted before it started', async () => {
  const { read, pending } = scriptedReads<{ value: string }>()
  render(
    <>
      <Grab />
      <Observer name="A" read={read} />
      <Observer name="B" read={read} />
    </>,
  )
  await act(async () => pending[0].resolve({ value: 'shared' }))
  await waitFor(() => expect(state('B')).toContain(' verified'))
  expect(state('A')).toContain(' verified')
  expect(read).toHaveBeenCalledTimes(1)
})

test('an older request that completes late is never adopted', async () => {
  const { read, pending } = scriptedReads<{ value: string }>()
  render(
    <>
      <Grab />
      <Observer name="A" read={read} />
    </>,
  )
  await act(async () => pending[0].resolve({ value: 'one' }))
  await waitFor(() => expect(state('A')).toContain(' verified'))
  // A refresh starts, then a newer request replaces it before it answers.
  act(() => {
    void client!.refetchQueries({ queryKey: key })
  })
  await waitFor(() => expect(pending).toHaveLength(2))
  act(() => {
    void client!.refetchQueries({ queryKey: key })
  })
  await waitFor(() => expect(pending).toHaveLength(3))
  await act(() => client!.setQueryData(key, { value: 'written' }))
  await act(async () => pending[1].resolve({ value: 'old' }))
  expect(state('A')).toContain('unverified')
  await act(async () => pending[2].resolve({ value: 'new' }))
  await waitFor(() => expect(state('A')).toBe('current verified after-hint new'))
})

test('a failed read and a removed query are not verified', async () => {
  const { read, pending } = scriptedReads<{ value: string }>()
  render(
    <>
      <Grab />
      <Observer name="A" read={read} />
    </>,
  )
  await act(async () => pending[0].resolve({ value: 'one' }))
  await waitFor(() => expect(state('A')).toContain(' verified'))

  // A failed refresh clears it and says so.
  act(() => {
    void client!.refetchQueries({ queryKey: key })
  })
  await waitFor(() => expect(pending).toHaveLength(2))
  await act(async () => pending[1].reject(new Error('offline')))
  await waitFor(() => expect(state('A')).toBe('failed unverified before-hint one'))

  // A later read verifies again.
  act(() => {
    void client!.refetchQueries({ queryKey: key })
  })
  await waitFor(() => expect(pending).toHaveLength(3))
  await act(async () => pending[2].resolve({ value: 'two' }))
  await waitFor(() => expect(state('A')).toBe('current verified after-hint two'))

  // Removing the query clears the proof.
  act(() => client!.removeQueries({ queryKey: key }))
  expect(freshReads(client!).verified(key, 0)).toBe(false)
})

test('a paused read is not verified', async () => {
  const { read, pending } = scriptedReads<{ value: string }>()
  const online = new QueryClient({
    defaultOptions: { queries: { retry: false, networkMode: 'online', refetchOnMount: 'always' } },
  })
  render(
    <ServerStateProvider client={online}>
      <Grab />
      <Observer name="A" read={read} />
    </ServerStateProvider>,
  )
  await waitFor(() => expect(pending.length).toBeGreaterThan(0))
  await act(async () => pending.at(-1)!.resolve({ value: 'one' }))
  await waitFor(() => expect(state('A')).toBe('current verified after-hint one'))
  onlineManager.setOnline(false)
  try {
    act(() => {
      void client!.refetchQueries({ queryKey: key })
    })
    await waitFor(() => expect(state('A')).toBe('failed unverified before-hint one'))
  } finally {
    onlineManager.setOnline(true)
  }
})

test('a live hint holds commands with no revision until a read started after it settles', async () => {
  const { read, pending } = scriptedReads<{ value: string }>()
  render(
    <>
      <Grab />
      <Observer name="A" read={read} />
    </>,
  )
  await act(async () => pending[0].resolve({ value: 'one' }))
  await waitFor(() => expect(state('A')).toBe('current verified after-hint one'))

  act(() => freshReads(client!).noteHint())
  // Revision-carrying commands stay available; the revisionless gate waits.
  expect(state('A')).toBe('current verified before-hint one')

  act(() => {
    void client!.invalidateQueries({ queryKey: key })
  })
  await waitFor(() => expect(pending).toHaveLength(2))
  expect(state('A')).toContain('before-hint')
  await act(async () => pending[1].resolve({ value: 'two' }))
  await waitFor(() => expect(state('A')).toBe('current verified after-hint two'))
})

test('a restored snapshot shows as cached and never verifies; the current predicate gates current', async () => {
  const { read, pending } = scriptedReads<{ value: string }>()
  render(
    <>
      <Grab />
      <Observer
        name="A"
        read={read}
        restored={{ value: 'restored' }}
        current={(data) => data.value === 'match'}
      />
    </>,
  )
  expect(state('A')).toBe('refreshing unverified before-hint restored')
  await act(async () => pending[0].resolve({ value: 'other' }))
  await waitFor(() => expect(state('A')).toBe('cached verified after-hint other'))
})

test('a new scope starts unverified, whatever the old scope verified', async () => {
  const { read, pending } = scriptedReads<{ value: string }>()

  function Scoped({ scope }: { scope: string }) {
    return (
      <ServerStateProvider key={scope}>
        <Grab />
        <Observer name={scope} read={read} />
      </ServerStateProvider>
    )
  }

  const view = render(<Scoped scope="first" />)
  await act(async () => pending[0].resolve({ value: 'one' }))
  await waitFor(() => expect(state('first')).toContain(' verified'))

  view.rerender(<Scoped scope="second" />)
  expect(state('second')).toBe('empty unverified before-hint none')
})

test('a cache write between a read’s return and its adoption still lets that read verify', async () => {
  const { read, pending } = scriptedReads<{ value: string }>()
  render(
    <>
      <Grab />
      <Observer name="A" read={read} />
    </>,
  )
  await waitFor(() => expect(pending).toHaveLength(1))
  await act(async () => {
    pending[0].resolve({ value: 'read' })
    // Runs after the query function returns and before TanStack writes its result.
    await Promise.resolve()
    client!.setQueryData(key, { value: 'written' })
  })
  await waitFor(() => expect(state('A')).toBe('current verified after-hint read'))
})

test('a state change that replaces the adopted data clears the proof', async () => {
  const { read, pending } = scriptedReads<{ value: string }>()
  render(
    <>
      <Grab />
      <Observer name="A" read={read} />
    </>,
  )
  await act(async () => pending[0].resolve({ value: 'read' }))
  await waitFor(() => expect(state('A')).toContain(' verified'))
  act(() => {
    client!
      .getQueryCache()
      .find({ queryKey: key })!
      .setState({ data: { value: 'hydrated' } })
  })
  await waitFor(() => expect(state('A')).toContain('unverified'))
})

test('a state change that keeps the data, or marks a running read idle, is not a verified settled read', async () => {
  const { read, pending } = scriptedReads<{ value: string }>()
  render(
    <>
      <Grab />
      <Observer name="A" read={read} />
    </>,
  )
  await act(async () => pending[0].resolve({ value: 'read' }))
  await waitFor(() => expect(state('A')).toContain(' verified'))
  const query = client!.getQueryCache().find({ queryKey: key })!

  act(() => query.setState({ data: query.state.data }))
  await waitFor(() => expect(state('A')).toContain('unverified'))

  // A newer read verifies again; while another runs, forcing the status idle settles nothing.
  act(() => {
    void client!.refetchQueries({ queryKey: key })
  })
  await waitFor(() => expect(pending).toHaveLength(2))
  await act(async () => pending[1].resolve({ value: 'two' }))
  await waitFor(() => expect(state('A')).toBe('current verified after-hint two'))
  act(() => {
    void client!.refetchQueries({ queryKey: key })
  })
  await waitFor(() => expect(pending).toHaveLength(3))
  act(() => query.setState({ fetchStatus: 'idle' }))
  await waitFor(() => expect(state('A')).toContain('unverified'))
  expect(state('A')).toContain('before-hint')
})

function Revisioned({
  revision,
  read,
}: {
  revision: string
  read: () => Promise<{ value: string }>
}) {
  const fresh = useFreshRead({ queryKey: [...key, revision], queryFn: read, keepPrevious: true })
  return <Report name="R" fresh={fresh} />
}

test('a new key shows the previous key’s data while it is first read, and only its own read verifies it', async () => {
  const { read, pending } = scriptedReads<{ value: string }>()
  const view = render(<Revisioned revision="1" read={read} />)
  await act(async () => pending[0].resolve({ value: 'first' }))
  await waitFor(() => expect(state('R')).toBe('current verified after-hint first'))

  view.rerender(<Revisioned revision="2" read={read} />)
  expect(state('R')).toBe('refreshing unverified before-hint first')
  await act(async () => pending[1].resolve({ value: 'second' }))
  await waitFor(() => expect(state('R')).toBe('current verified after-hint second'))
})
