import { screen, fireEvent, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { expect, test, vi } from 'vitest'
import { render } from '#/test/render'
import { chatMessages } from '#/processing/session-history'
import { H, chat, input, reply, status } from '#/test/session-history'
import { SessionChatPanel as SessionChat } from './SessionChatPanel'

// Newest first, as the history read returns them.
const entries = [
  reply(4, 5, 'Thanks, checking the back label.'),
  chat(1, 4, 'Check the back label.'),
  status(3, 3, 'Comparing markings'),
  status(1, 1, 'Reading the label'),
]

test('chat shows the operator message and the agent reply in order', () => {
  render(
    <SessionChat
      storeKey="batch:chat"
      state="running"
      messages={chatMessages(entries)}
      send={vi.fn()}
      startFresh={vi.fn()}
    />,
  )
  const log = screen.getByRole('log', { name: 'Session messages' })
  const messages = [...log.children]
  expect(messages).toHaveLength(2)
  expect(messages[0]).toHaveTextContent('You')
  expect(messages[0]).toHaveTextContent('Check the back label.')
  expect(messages[1]).toHaveTextContent('Agent')
  expect(messages[1]).toHaveTextContent('Thanks, checking the back label.')
})

test('the composer queues a message for a finished session', async () => {
  const send = vi.fn().mockResolvedValue(undefined)
  render(
    <SessionChat storeKey="batch:finished" state="finished" send={send} startFresh={vi.fn()} />,
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
  const send = vi.fn().mockRejectedValueOnce(new Error('offline')).mockResolvedValue(undefined)
  render(
    <SessionChat storeKey="batch:running-1" state="running" send={send} startFresh={vi.fn()} />,
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
    <SessionChat storeKey="batch:running-2" state="running" send={send} startFresh={vi.fn()} />,
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
  const send = vi.fn().mockRejectedValueOnce(new Error('offline')).mockResolvedValue(undefined)
  const view = render(
    <SessionChat storeKey="batch:navigate" state="finished" send={send} startFresh={vi.fn()} />,
  )
  fireEvent.change(screen.getByLabelText('Message this session'), {
    target: { value: 'Back label?' },
  })
  fireEvent.click(screen.getByRole('button', { name: 'Send' }))
  await screen.findByText(/was not confirmed/)
  view.unmount()
  render(
    <SessionChat storeKey="batch:navigate" state="finished" send={send} startFresh={vi.fn()} />,
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
    .mockResolvedValue(undefined)
  const view = render(
    <SessionChat storeKey="batch:in-flight" state="finished" send={send} startFresh={vi.fn()} />,
  )
  fireEvent.change(screen.getByLabelText('Message this session'), {
    target: { value: 'Back label?' },
  })
  fireEvent.click(screen.getByRole('button', { name: 'Send' }))
  view.unmount()
  render(
    <SessionChat storeKey="batch:in-flight" state="finished" send={send} startFresh={vi.fn()} />,
  )
  expect(screen.getByText(/Sending “Back label\?”/)).toBeVisible()
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
  const send = vi.fn().mockResolvedValue(undefined)
  render(<SessionChat storeKey="batch:failed" state="failed" send={send} startFresh={vi.fn()} />)
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

test('a cancelled session keeps its conversation visible', () => {
  render(
    <SessionChat
      storeKey="batch:cancelled-history"
      state="cancelled"
      messages={[{ id: 'm', who: 'You', text: 'Check the back.', mine: true }]}
      send={vi.fn()}
      startFresh={vi.fn()}
    />,
  )
  expect(screen.getByRole('log', { name: 'Session messages' })).toHaveTextContent('Check the back.')
  expect(screen.getByLabelText('Message this session')).toBeDisabled()
})

test('replies from a replacement session keep their own identity', () => {
  const ids = chatMessages([
    { ...reply(1, 2, 'Two'), attempt: 2, id: `outbox:${H.attempt2}:1` },
    reply(1, 1, 'One'),
  ]).map((message) => message.id)
  expect(new Set(ids).size).toBe(2)
})

test('the drawer chat shows /1 and /2 answers beside the messages', () => {
  const answered = [
    input(2, 5, {
      kind: 'answer',
      answer: {
        question_id: H.question,
        answer_id: H.inboxItem,
        steps: [
          { step_id: 'same', value: { kind: 'choice', option_id: 'yes', label: 'same Part' } },
          { step_id: 'left', value: { kind: 'number', value: '380', basis: 'estimated' } },
          { step_id: 'place', value: { kind: 'choice', other: 'Drawer R4' } },
        ],
      },
      effects: [],
    }),
    input(1, 4, {
      kind: 'answer',
      answer: {
        question_id: H.question,
        answer_id: H.proposal,
        value: { kind: 'quantity', value: '12', basis: 'counted' },
      },
      effects: [],
    }),
  ]
  render(
    <SessionChat
      storeKey="batch:answers"
      state="running"
      messages={chatMessages(answered, { answers: true })}
      send={vi.fn()}
      startFresh={vi.fn()}
    />,
  )
  const messages = [...screen.getByRole('log', { name: 'Session messages' }).children]
  expect(messages[0]).toHaveTextContent('Answered: 12')
  expect(messages[1]).toHaveTextContent('Answered: same Part · 380 estimated · Drawer R4')
})

test('a retry waits while sending is unavailable, then reuses the original message and key', async () => {
  const send = vi.fn().mockRejectedValueOnce(new Error('offline')).mockResolvedValue(undefined)

  const panel = (unavailable?: string) => (
    <SessionChat
      storeKey="batch:guarded-retry"
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
