import { act, fireEvent, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { expect, test, vi } from 'vitest'
import type { MediaReceiptDto } from '@invimport/contracts'
import { IntakeRequestError } from '@invimport/contracts/client'
import { render } from '#/test/render'
import { useUploadQueue, type UploadQueuePorts } from '#/media/useUploadQueue'
import { MediaUpload } from './MediaUpload'

type HarnessProps = UploadQueuePorts & { disabled: boolean }

function Harness({ disabled, ...ports }: HarnessProps) {
  const queue = useUploadQueue(ports)
  return (
    <MediaUpload disabled={disabled} chooseDisabled={disabled} noteDisabled={false} queue={queue} />
  )
}

function receipt(name: string): MediaReceiptDto {
  return {
    status: 'retained',
    batch_id: '10000000-0000-4000-8000-000000000001',
    evidence_id: `evidence-${name}`,
    version: {
      id: `version-${name}`,
      evidence_id: `evidence-${name}`,
      kind: 'original',
      digest: 'a'.repeat(64),
      byte_size: '4',
      media_type: 'image/png',
      state: 'queued',
      decoder_build: null,
      recipe: null,
      pages: [],
    },
  }
}

function ports(overrides: Partial<UploadQueuePorts> = {}): UploadQueuePorts {
  let revision = 1
  return {
    currentRevision: vi.fn(async () => String(revision++)),
    upload: vi.fn(async (file: File) => receipt(file.name)),
    finish: vi.fn(async () => true),
    onDirtyChange: vi.fn(),
    ...overrides,
  }
}

function photo(name: string) {
  return new File(['data'], name, { type: 'image/png' })
}

function deferred<T>() {
  let resolve: (value: T) => void = () => undefined

  let reject: (reason: unknown) => void = () => undefined

  const promise = new Promise<T>((done, fail) => {
    resolve = done
    reject = fail
  })
  return { promise, resolve, reject }
}

// The picker returns focus, which briefly re-reads the batch; the chosen file arrives in that window.
test('a photo chosen while uploads are briefly unavailable starts uploading at once', async () => {
  const queue = ports()
  render(<Harness {...queue} disabled />)

  fireEvent.change(screen.getByLabelText('Choose photos'), {
    target: { files: [photo('bench.jpg')] },
  })

  await waitFor(() => expect(queue.upload).toHaveBeenCalledOnce())
  expect(screen.queryByRole('button', { name: /Retain/ })).toBeNull()
  expect(screen.queryByRole('button', { name: /Discard/ })).toBeNull()
})

test('pickers accept several files', () => {
  render(<Harness {...ports()} disabled={false} />)
  expect(screen.getByLabelText('Choose photos')).toHaveAttribute('multiple')
  expect(screen.getByLabelText('Choose document')).toHaveAttribute('multiple')
})

test('several files upload one after another, each with its own key and the current revision', async () => {
  const user = userEvent.setup()
  const first = deferred<MediaReceiptDto>()
  const queue = ports({
    upload: vi.fn(async (file: File) =>
      file.name === 'a.png' ? first.promise : receipt(file.name),
    ),
  })
  render(<Harness {...queue} disabled={false} />)

  await user.upload(screen.getByLabelText('Choose photos'), [
    photo('a.png'),
    photo('b.png'),
    photo('c.png'),
  ])

  await waitFor(() => expect(queue.upload).toHaveBeenCalledOnce())
  const files = screen.getByRole('list', { name: 'Uploads' })
  expect(within(files).getAllByText('Uploading…')).toHaveLength(3)
  expect(queue.onDirtyChange).toHaveBeenLastCalledWith(true)

  await act(async () => first.resolve(receipt('a.png')))
  await waitFor(() => expect(queue.upload).toHaveBeenCalledTimes(3))
  await waitFor(() => expect(queue.finish).toHaveBeenCalledTimes(3))

  const calls = vi.mocked(queue.upload).mock.calls
  expect(calls.map(([file]) => file.name)).toEqual(['a.png', 'b.png', 'c.png'])
  expect(calls.map(([, , revision]) => revision)).toEqual(['1', '2', '3'])
  expect(new Set(calls.map(([, key]) => key)).size).toBe(3)
  await waitFor(() => expect(queue.onDirtyChange).toHaveBeenLastCalledWith(false))
  expect(screen.queryByRole('list', { name: 'Uploads' })).toBeNull()
})

test('a refused file shows Not added with its reason and Dismiss, and later files continue', async () => {
  const user = userEvent.setup()
  const queue = ports({
    upload: vi.fn(async (file: File) => {
      if (file.name === 'a.png') {
        throw new IntakeRequestError(409, 'media_capacity')
      }
      return receipt(file.name)
    }),
  })
  render(<Harness {...queue} disabled={false} />)

  await user.upload(screen.getByLabelText('Choose photos'), [photo('a.png'), photo('b.png')])

  const refused = await screen.findByRole('listitem', { name: 'a.png' })
  expect(within(refused).getByText(/Not added/)).toBeVisible()
  expect(within(refused).getByText(/evidence limit/)).toBeVisible()
  await waitFor(() => expect(queue.finish).toHaveBeenCalledOnce())
  expect(vi.mocked(queue.upload).mock.calls[1][0].name).toBe('b.png')
  // A file that was not added leaves nothing to protect.
  await waitFor(() => expect(queue.onDirtyChange).toHaveBeenLastCalledWith(false))

  await user.click(within(refused).getByRole('button', { name: 'Dismiss a.png' }))
  expect(screen.queryByRole('listitem', { name: 'a.png' })).toBeNull()
})

test('an unsupported file shows Not added without sending anything', async () => {
  const user = userEvent.setup({ applyAccept: false })
  const queue = ports()
  render(<Harness {...queue} disabled={false} />)

  await user.upload(
    screen.getByLabelText('Choose photos'),
    new File(['gif'], 'packet.gif', { type: 'image/gif' }),
  )

  const refused = screen.getByRole('listitem', { name: 'packet.gif' })
  expect(within(refused).getByText(/Not added/)).toBeVisible()
  expect(within(refused).getByText(/JPEG or PNG/)).toBeVisible()
  expect(queue.upload).not.toHaveBeenCalled()
  expect(queue.currentRevision).not.toHaveBeenCalled()
})

test('a lost response leaves Retry, later files continue, and Retry resends the identical request', async () => {
  const user = userEvent.setup()
  let lose = true
  const queue = ports({
    upload: vi.fn(async (file: File) => {
      if (file.name === 'a.png' && lose) {
        lose = false
        throw new TypeError('network')
      }
      return receipt(file.name)
    }),
  })
  render(<Harness {...queue} disabled={false} />)

  await user.upload(screen.getByLabelText('Choose photos'), [photo('a.png'), photo('b.png')])

  const unconfirmed = await screen.findByRole('listitem', { name: 'a.png' })
  expect(within(unconfirmed).getByText(/Upload not confirmed/)).toBeVisible()
  await waitFor(() => expect(queue.finish).toHaveBeenCalledOnce())
  expect(queue.onDirtyChange).toHaveBeenLastCalledWith(true)

  await user.click(within(unconfirmed).getByRole('button', { name: 'Retry a.png' }))

  await waitFor(() => expect(queue.upload).toHaveBeenCalledTimes(3))
  const calls = vi.mocked(queue.upload).mock.calls
  expect(calls[2]).toEqual(calls[0])
  expect(calls[2][0]).toBe(calls[0][0])
  await waitFor(() => expect(queue.finish).toHaveBeenCalledTimes(2))
  expect(vi.mocked(queue.finish).mock.calls[1][0]).toEqual(receipt('a.png'))
  await waitFor(() => expect(queue.onDirtyChange).toHaveBeenLastCalledWith(false))
  expect(screen.queryByRole('listitem', { name: 'a.png' })).toBeNull()
})

test('Retry that meets a revision refusal sends the file once more with a new key at the current revision', async () => {
  const user = userEvent.setup()
  const attempts: string[] = []
  const queue = ports({
    upload: vi.fn(async (file: File, key: string) => {
      attempts.push(key)
      if (attempts.length === 1) {
        throw new TypeError('network')
      }
      if (attempts.length === 2) {
        throw new IntakeRequestError(412, 'revision_conflict')
      }
      return receipt(file.name)
    }),
  })
  render(<Harness {...queue} disabled={false} />)

  await user.upload(screen.getByLabelText('Choose photos'), photo('a.png'))
  const unconfirmed = await screen.findByRole('listitem', { name: 'a.png' })
  await user.click(within(unconfirmed).getByRole('button', { name: 'Retry a.png' }))

  await waitFor(() => expect(queue.finish).toHaveBeenCalledOnce())
  const calls = vi.mocked(queue.upload).mock.calls
  expect(calls).toHaveLength(3)
  expect(calls[1]).toEqual(calls[0])
  expect(calls[2][1]).not.toBe(calls[0][1])
  expect(calls[2][2]).toBe('2')
  expect(calls[2][0]).toBe(calls[0][0])
})

test('a second revision refusal marks the file Not added', async () => {
  const user = userEvent.setup()
  const queue = ports({
    upload: vi.fn(async () => {
      throw new IntakeRequestError(412, 'revision_conflict')
    }),
  })
  render(<Harness {...queue} disabled={false} />)

  await user.upload(screen.getByLabelText('Choose photos'), photo('a.png'))

  const refused = await screen.findByRole('listitem', { name: 'a.png' })
  expect(within(refused).getByText(/Not added/)).toBeVisible()
  expect(queue.upload).toHaveBeenCalledTimes(2)
  expect(queue.finish).not.toHaveBeenCalled()
})

test('a retained file whose read fails stays protected and offers the read again, never a second upload', async () => {
  const user = userEvent.setup()
  const queue = ports({ finish: vi.fn().mockRejectedValueOnce(new Error('offline')) })
  vi.mocked(queue.finish).mockResolvedValue(true)
  render(<Harness {...queue} disabled={false} />)

  await user.upload(screen.getByLabelText('Choose photos'), photo('a.png'))

  const unread = await screen.findByRole('listitem', { name: 'a.png' })
  expect(within(unread).getByText(/Added\. The current evidence could not be read/)).toBeVisible()
  expect(queue.onDirtyChange).toHaveBeenLastCalledWith(true)
  expect(within(unread).queryByRole('button', { name: 'Retry a.png' })).toBeNull()

  await user.click(within(unread).getByRole('button', { name: 'Read a.png again' }))
  await waitFor(() => expect(queue.onDirtyChange).toHaveBeenLastCalledWith(false))
  expect(queue.upload).toHaveBeenCalledOnce()
  expect(queue.finish).toHaveBeenCalledTimes(2)
})

test('a file that could not join its group says so and stays dismissible', async () => {
  const user = userEvent.setup()
  const queue = ports({ finish: vi.fn(async () => false) })
  render(<Harness {...queue} disabled={false} />)

  await user.upload(screen.getByLabelText('Choose photos'), photo('a.png'))

  const ungrouped = await screen.findByRole('listitem', { name: 'a.png' })
  expect(within(ungrouped).getByText(/Added to Ungrouped/)).toBeVisible()
  await waitFor(() => expect(queue.onDirtyChange).toHaveBeenLastCalledWith(false))
  await user.click(within(ungrouped).getByRole('button', { name: 'Dismiss a.png' }))
  expect(screen.queryByRole('listitem', { name: 'a.png' })).toBeNull()
})
