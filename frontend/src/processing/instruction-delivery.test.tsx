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

let leave: () => void = () => undefined

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
  const [onProcessing, setOnProcessing] = useState(true)
  leave = () => setOnProcessing(false)
  const delivery = useInstructionDelivery('batch', send, () =>
    freshReads(client!).requestRead(key, read),
  )
  deliver = delivery.deliver
  return (
    <>
      <output aria-label="Delivery">{delivery.delivery.status}</output>
      {onProcessing && <ProcessingRead read={read} />}
    </>
  )
}

test('delivery held across a hint and leaving Processing reads for itself, then sends once', async () => {
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
  await waitFor(() => expect(reads).toHaveLength(2))
  act(() => freshReads(client!).noteHint())
  // The save returns: delivery is due. Then the operator leaves Processing.
  act(() => {
    void deliver!()
  })
  expect(screen.getByLabelText('Delivery')).toHaveTextContent('pending')
  act(() => leave())
  // Retry while pending goes through the same gate.
  act(() => {
    void deliver!()
  })

  // The read running when the hint arrived settles without sending, and delivery reads again.
  await act(async () => reads[1].resolve('before the hint'))
  await waitFor(() => expect(reads).toHaveLength(3))
  expect(send).not.toHaveBeenCalled()

  // Another hint while that read runs: it is not enough either.
  act(() => freshReads(client!).noteHint())
  await act(async () => reads[2].resolve('before the second hint'))
  await waitFor(() => expect(reads).toHaveLength(4))
  expect(send).not.toHaveBeenCalled()
  expect(screen.getByLabelText('Delivery')).toHaveTextContent('pending')

  await act(async () => reads[3].resolve('after'))
  await waitFor(() => expect(screen.getByLabelText('Delivery')).toHaveTextContent('sent'))
  expect(send).toHaveBeenCalledTimes(1)
})

test('a failed read while delivery is pending reports the delivery as failed, with Retry', async () => {
  const read = vi
    .fn<() => Promise<string>>()
    .mockResolvedValueOnce('first')
    .mockRejectedValue(new Error('offline'))
  const send = vi.fn(async () => ({ sessions: 1, woken: 0 }))
  render(<Owner send={send} read={read} />)
  await waitFor(() => expect(read).toHaveBeenCalledTimes(1))
  act(() => {
    void deliver!()
  })
  await waitFor(() => expect(screen.getByLabelText('Delivery')).toHaveTextContent('failed'))
  expect(send).not.toHaveBeenCalled()
})
