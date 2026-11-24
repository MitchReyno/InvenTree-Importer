import { screen, fireEvent, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { expect, test, vi } from 'vitest'
import { render } from '#/test/render'
import { SessionChatPanel as SessionChat } from './SessionChatPanel'

test('the composer queues a message for a finished session', async () => {
  const send = vi.fn().mockResolvedValue({ seq: '1' })
  render(
    <SessionChat
      storeKey="batch:finished"
      batchId="batch"
      jobId="job"
      state="finished"
      send={send}
      startFresh={vi.fn()}
    />,
  )
  const field = screen.getByLabelText('Message this session')
  expect(field).toBeEnabled()
  fireEvent.change(field, { target: { value: 'Is the date code readable?' } })
  fireEvent.click(screen.getByRole('button', { name: 'Send' }))
  await screen.findByText(/Queued/)
  expect(send).toHaveBeenCalledWith('Is the date code readable?', expect.any(String))
  await waitFor(() => expect(field).toHaveValue(''))
})

test('an unconfirmed send keeps its message and key until retried or discarded', async () => {
  const send = vi.fn().mockRejectedValueOnce(new Error('offline')).mockResolvedValue({ seq: '1' })
  render(
    <SessionChat
      storeKey="batch:running-1"
      batchId="batch"
      jobId="job"
      state="running"
      send={send}
      startFresh={vi.fn()}
    />,
  )
  fireEvent.change(screen.getByLabelText('Message this session'), {
    target: { value: 'Is the date code readable?' },
  })
  fireEvent.click(screen.getByRole('button', { name: 'Send' }))
  await screen.findByText(/was not confirmed/)
  // A new draft cannot be sent, nor can it change the pending message or its key.
  fireEvent.change(screen.getByLabelText('Message this session'), { target: { value: 'Another' } })
  expect(screen.getByRole('button', { name: 'Send' })).toBeDisabled()
  fireEvent.click(screen.getByRole('button', { name: 'Retry this message' }))
  await screen.findByText(/Queued/)
  expect(send).toHaveBeenCalledTimes(2)
  expect(send.mock.calls[1]).toEqual(send.mock.calls[0])
  expect(send.mock.calls[1][0]).toBe('Is the date code readable?')
  expect(screen.getByLabelText('Message this session')).toHaveValue('Another')
})

test('discarding an unconfirmed send frees the composer', async () => {
  const send = vi.fn().mockRejectedValueOnce(new Error('offline'))
  render(
    <SessionChat
      storeKey="batch:running-2"
      batchId="batch"
      jobId="job"
      state="running"
      send={send}
      startFresh={vi.fn()}
    />,
  )
  fireEvent.change(screen.getByLabelText('Message this session'), { target: { value: 'Hello' } })
  fireEvent.click(screen.getByRole('button', { name: 'Send' }))
  fireEvent.click(await screen.findByRole('button', { name: 'Discard' }))
  expect(screen.queryByText(/was not confirmed/)).not.toBeInTheDocument()
})

test('a cancelled session offers a fresh session and takes no messages', () => {
  const startFresh = vi.fn()
  render(
    <SessionChat
      storeKey="batch:cancelled"
      batchId="batch"
      jobId="job"
      state="cancelled"
      send={vi.fn()}
      startFresh={startFresh}
    />,
  )
  expect(screen.getByLabelText('Message this session')).toBeDisabled()
  fireEvent.click(screen.getByRole('button', { name: 'Start a fresh session' }))
  expect(startFresh).toHaveBeenCalled()
})

test('an unconfirmed send survives leaving and returning to the session', async () => {
  const send = vi.fn().mockRejectedValueOnce(new Error('offline')).mockResolvedValue({ seq: '1' })
  const view = render(
    <SessionChat
      storeKey="batch:navigate"
      batchId="batch"
      jobId="job"
      state="finished"
      send={send}
      startFresh={vi.fn()}
    />,
  )
  fireEvent.change(screen.getByLabelText('Message this session'), {
    target: { value: 'Back label?' },
  })
  fireEvent.click(screen.getByRole('button', { name: 'Send' }))
  await screen.findByText(/was not confirmed/)
  view.unmount()
  render(
    <SessionChat
      storeKey="batch:navigate"
      batchId="batch"
      jobId="job"
      state="finished"
      send={send}
      startFresh={vi.fn()}
    />,
  )
  fireEvent.click(await screen.findByRole('button', { name: 'Retry this message' }))
  await screen.findByText(/Queued/)
  expect(send.mock.calls[1]).toEqual(send.mock.calls[0])
})

test('leaving during an unresolved send cannot start a second send of it', async () => {
  let reject: (error: Error) => void = () => {}

  const send = vi
    .fn()
    .mockImplementationOnce(() => new Promise((_, fail) => (reject = fail)))
    .mockResolvedValue({ seq: '1' })
  const view = render(
    <SessionChat
      storeKey="batch:in-flight"
      batchId="batch"
      jobId="job"
      state="finished"
      send={send}
      startFresh={vi.fn()}
    />,
  )
  fireEvent.change(screen.getByLabelText('Message this session'), {
    target: { value: 'Back label?' },
  })
  fireEvent.click(screen.getByRole('button', { name: 'Send' }))
  view.unmount()
  render(
    <SessionChat
      storeKey="batch:in-flight"
      batchId="batch"
      jobId="job"
      state="finished"
      send={send}
      startFresh={vi.fn()}
    />,
  )
  fireEvent.change(screen.getByLabelText('Message this session'), {
    target: { value: 'Back label?' },
  })
  expect(screen.getByRole('button', { name: 'Send' })).toBeDisabled()
  reject(new Error('lost'))
  fireEvent.click(await screen.findByRole('button', { name: 'Retry this message' }))
  await screen.findByText(/Queued/)
  expect(send).toHaveBeenCalledTimes(2)
  expect(send.mock.calls[1]).toEqual(send.mock.calls[0])
})

test('a failed session explains that a fresh session is needed after sending', async () => {
  const send = vi.fn().mockResolvedValue({ seq: '1' })
  render(
    <SessionChat
      storeKey="batch:failed"
      batchId="batch"
      jobId="job"
      state="failed"
      send={send}
      startFresh={vi.fn()}
    />,
  )
  fireEvent.change(screen.getByLabelText('Message this session'), { target: { value: 'Hello?' } })
  fireEvent.click(screen.getByRole('button', { name: 'Send' }))
  expect(await screen.findByText(/start a fresh session to continue/)).toBeVisible()
})

test('offers explicit replacement for an incompatible conversation without losing the draft', async () => {
  const startFresh = vi.fn()
  const send = vi.fn()
  render(
    <SessionChat
      storeKey="batch:legacy"
      batchId="batch"
      jobId="job"
      state="resume_unavailable"
      send={send}
      startFresh={startFresh}
    />,
  )
  await userEvent.type(
    screen.getByRole('textbox', { name: 'Message this session' }),
    'Keep my draft',
  )
  expect(screen.getByText(/History and queued messages will be kept/)).toBeVisible()
  expect(startFresh).not.toHaveBeenCalled()
  await userEvent.click(screen.getByRole('button', { name: 'Start a fresh session' }))
  expect(startFresh).toHaveBeenCalledOnce()
  expect(send).not.toHaveBeenCalled()
  expect(screen.getByRole('textbox', { name: 'Message this session' })).toHaveValue('Keep my draft')
})

test('a cancelled session takes no messages', () => {
  render(
    <SessionChat
      storeKey="batch:cancelled-history"
      batchId="batch"
      jobId="job"
      state="cancelled"
      send={vi.fn()}
      startFresh={vi.fn()}
    />,
  )
  // The conversation is the history above; the box has no message list of its own.
  expect(screen.queryByRole('log')).toBeNull()
  expect(screen.getByLabelText('Message this session')).toBeDisabled()
})

test('a retry waits while sending is unavailable, then reuses the original message and key', async () => {
  const send = vi.fn().mockRejectedValueOnce(new Error('offline')).mockResolvedValue({ seq: '1' })

  const panel = (unavailable?: string) => (
    <SessionChat
      storeKey="batch:guarded-retry"
      batchId="batch"
      jobId="job"
      state="running"
      send={send}
      startFresh={vi.fn()}
      sendUnavailable={unavailable}
    />
  )

  const view = render(panel())
  fireEvent.change(screen.getByLabelText('Message this session'), {
    target: { value: 'Check the reel label' },
  })
  fireEvent.click(screen.getByRole('button', { name: 'Send' }))
  await screen.findByText(/was not confirmed/)

  view.rerender(panel('Updating…'))
  expect(screen.getByRole('button', { name: 'Retry this message' })).toBeDisabled()
  fireEvent.click(screen.getByRole('button', { name: 'Retry this message' }))
  expect(send).toHaveBeenCalledTimes(1)

  view.rerender(panel())
  fireEvent.click(screen.getByRole('button', { name: 'Retry this message' }))
  await screen.findByText(/Queued/)
  expect(send.mock.calls[1]).toEqual(send.mock.calls[0])
})
