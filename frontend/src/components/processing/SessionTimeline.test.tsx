import { screen, within, fireEvent, waitFor } from '@testing-library/react'
import { expect, test, vi } from 'vitest'
import type { SessionTimelineDto } from '@invimport/contracts'
import { render } from '../../test/render'
import { SessionTimeline } from './SessionTimeline'
import { SessionChat } from './SessionChat'

const at = (second: number) => `2026-11-06T01:00:${String(second).padStart(2, '0')}.000Z`

const timeline: SessionTimelineDto = {
  job_id: 'job',
  attempt_id: 'attempt',
  session_state: 'running',
  outbox: [
    {
      session_id: 'attempt',
      seq: '1',
      kind: 'status',
      payload: { text: 'Reading the label' },
      created_at: at(1),
    },
    {
      session_id: 'attempt',
      seq: '2',
      kind: 'proposal',
      payload: { proposal_id: 'p1' },
      created_at: at(2),
    },
    {
      session_id: 'attempt',
      seq: '3',
      kind: 'status',
      payload: { text: 'Comparing markings' },
      created_at: at(3),
    },
    {
      session_id: 'attempt',
      seq: '4',
      kind: 'reply',
      payload: { inbox_item_id: 'chat-1', text: 'Thanks, checking the back label.' },
      created_at: at(5),
    },
  ],
  inbox: [
    {
      id: 'chat-1',
      seq: '1',
      kind: 'chat',
      payload: { text: 'Check the back label.' },
      created_at: at(4),
    },
  ],
  truncated: false,
}

test('status lines form an ordered timeline and the latest is the current activity', () => {
  render(<SessionTimeline timeline={timeline} />)
  const steps = within(screen.getByRole('list', { name: 'Session steps' })).getAllByRole('listitem')
  expect(steps.map((step) => step.textContent)).toEqual([
    expect.stringContaining('Reading the label'),
    expect.stringContaining('Published a proposal'),
    expect.stringContaining('Comparing markings'),
  ])
  expect(screen.getByRole('status')).toHaveTextContent('Current activity: Comparing markings')
  expect(screen.getByRole('status')).not.toHaveTextContent('Reading the label')
})

test('chat shows the operator message and the agent reply in order', () => {
  render(<SessionTimeline timeline={timeline} />)
  const chat = within(screen.getByRole('list', { name: 'Chat' })).getAllByRole('listitem')
  expect(chat.map((item) => item.textContent)).toEqual([
    'You: Check the back label.',
    'Agent: Thanks, checking the back label.',
  ])
})

test('the composer queues a message for a finished session', async () => {
  const send = vi.fn().mockResolvedValue(undefined)
  render(<SessionChat state="finished" send={send} startFresh={vi.fn()} />)
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
  render(<SessionChat state="running" send={send} startFresh={vi.fn()} />)
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
  render(<SessionChat state="running" send={send} startFresh={vi.fn()} />)
  fireEvent.change(screen.getByLabelText('Message this session'), { target: { value: 'Hello' } })
  fireEvent.click(screen.getByRole('button', { name: 'Send' }))
  fireEvent.click(await screen.findByRole('button', { name: 'Discard' }))
  expect(screen.queryByText(/was not confirmed/)).not.toBeInTheDocument()
})

test('a cancelled session offers a fresh session instead of the composer', () => {
  const startFresh = vi.fn()
  render(<SessionChat state="cancelled" send={vi.fn()} startFresh={startFresh} />)
  expect(screen.queryByLabelText('Message this session')).not.toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: 'Start a fresh session' }))
  expect(startFresh).toHaveBeenCalled()
})
