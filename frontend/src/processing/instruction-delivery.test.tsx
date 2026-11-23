import { act, screen, waitFor } from '@testing-library/react'
import { useQueryClient, type QueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { expect, test, vi } from 'vitest'
import { render } from '#/test/render'
import { freshReads } from '#/queries/fresh-reads'
import { useFreshRead } from '#/queries/useFreshRead'
import { useInstructionDelivery } from './instruction-delivery'

const key = ['intake', 'fixture', 'processing', 'batch']

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => {
    resolve = done
  })
  return { promise, resolve }
}

let client: QueryClient | undefined
let deliver: (() => Promise<void>) | undefined

let remount: () => void = () => undefined

/** Processing's read, remounted as an instruction save's reload remounts it. */
function ProcessingRead({ read }: { read: () => Promise<string> }) {
  useFreshRead({ queryKey: key, queryFn: read })
  return null
}

/** The delivery owner above Processing, as `Batch` holds it. */
function Owner({
  send,
  read,
}: {
  send: () => Promise<{ sessions: number; woken: number }>
  read: () => Promise<string>
}) {
  client = useQueryClient()
  const [mount, setMount] = useState(0)
  remount = () => setMount((count) => count + 1)
  const delivery = useInstructionDelivery('batch', send, async (signal) => {
    const ready = freshReads(client!).waitForReadStartedNow(key, signal)
    void client!.invalidateQueries({ queryKey: key })
    await ready
  })
  deliver = delivery.deliver
  return (
    <>
      <output aria-label="Delivery">{delivery.delivery.status}</output>
      <ProcessingRead key={mount} read={read} />
    </>
  )
}

test('an instruction save whose hint arrives first holds delivery pending across the reload, then sends once', async () => {
  const reads: ReturnType<typeof deferred<string>>[] = []
  const read = vi.fn(() => {
    const next = deferred<string>()
    reads.push(next)
    return next.promise
  })
  const send = vi.fn(async () => ({ sessions: 1, woken: 0 }))
  render(<Owner send={send} read={read} />)
  await act(async () => reads[0].resolve('before'))

  // The save's live hint lands before the save returns, while a read started earlier runs.
  act(() => {
    void client!.refetchQueries({ queryKey: key })
  })
  act(() => freshReads(client!).noteHint())
  // The save returns: delivery is due, and Processing reloads.
  act(() => {
    void deliver!()
    remount()
  })
  expect(screen.getByLabelText('Delivery')).toHaveTextContent('pending')
  // Retry while pending goes through the same gate, and the held send is still sent once.
  act(() => {
    void deliver!()
  })
  await waitFor(() => expect(reads).toHaveLength(4))

  // The read running when the hint arrived, and the one the replaced wait asked for, settle
  // without sending: neither is the newest read started after the request.
  await act(async () => reads[1].resolve('before the hint'))
  await act(async () => reads[2].resolve('replaced'))
  expect(send).not.toHaveBeenCalled()
  expect(screen.getByLabelText('Delivery')).toHaveTextContent('pending')

  await act(async () => reads[3].resolve('after'))
  await waitFor(() => expect(screen.getByLabelText('Delivery')).toHaveTextContent('sent'))
  expect(send).toHaveBeenCalledTimes(1)
})
