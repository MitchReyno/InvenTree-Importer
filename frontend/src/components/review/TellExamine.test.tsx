import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { expect, it, vi } from 'vitest'
import type { ProcessingClient } from '../../processing/types'
import { render } from '../../test/render'
import { TellExamine } from './TellExamine'

const snapshot = (state: string | null) => ({
  jobs: [
    {
      id: 'lead',
      stage: 'examine',
      subject_id: null,
      ...(state ? { session_state: state } : {}),
    },
  ],
})

function client(session: boolean | string) {
  const state = session === true ? 'running' : session === false ? null : session
  return {
    read: vi.fn(async () => snapshot(state)),
    session: vi.fn(),
    chat: vi.fn(async () => ({ id: 'inbox-1' })),
  } as unknown as ProcessingClient & { chat: ReturnType<typeof vi.fn> }
}

it('sends a free-text instruction to the Examine lead session', async () => {
  const user = userEvent.setup()
  const processing = client(true)
  render(<TellExamine batchId="b" processing={processing} />)
  await user.type(
    await screen.findByLabelText('Instruction for Examine'),
    'The two reels are one lot',
  )
  await user.click(screen.getByRole('button', { name: 'Tell Examine' }))

  await waitFor(() =>
    expect(processing.chat).toHaveBeenCalledWith(
      'b',
      'lead',
      { idempotency_key: expect.any(String), text: 'The two reels are one lot' },
      expect.any(String),
    ),
  )
  expect(await screen.findByRole('status')).toHaveTextContent(
    'Queued. The agent receives it during this turn.',
  )
  expect(screen.getByLabelText('Instruction for Examine')).toHaveValue('')
})

it('keeps the instruction when it is not accepted', async () => {
  const user = userEvent.setup()
  const processing = client(true)
  processing.chat.mockRejectedValueOnce(new Error('refused'))
  render(<TellExamine batchId="b" processing={processing} />)
  await user.type(await screen.findByLabelText('Instruction for Examine'), 'Merge them')
  await user.click(screen.getByRole('button', { name: 'Tell Examine' }))

  expect(await screen.findByRole('alert')).toHaveTextContent('may already be queued')
  expect(screen.getByLabelText('Instruction for Examine')).toHaveValue('Merge them')

  // Sending the kept text again reuses its key, so it cannot be queued twice.
  await user.click(screen.getByRole('button', { name: 'Tell Examine' }))
  await waitFor(() => expect(processing.chat).toHaveBeenCalledTimes(2))
  const [first, second] = processing.chat.mock.calls
  expect(second[3]).toBe(first[3])
  expect(second[2]).toEqual(first[2])
})

it('is not offered for a cancelled Examine session', async () => {
  const processing = client('cancelled')
  render(<TellExamine batchId="b" processing={processing} />)
  await waitFor(() => expect(processing.read).toHaveBeenCalled())
  expect(screen.queryByLabelText('Instruction for Examine')).not.toBeInTheDocument()
})

it('shows no instruction field without an Examine session', async () => {
  const processing = client(false)
  render(<TellExamine batchId="b" processing={processing} />)
  await waitFor(() => expect(processing.read).toHaveBeenCalled())
  expect(screen.queryByLabelText('Instruction for Examine')).not.toBeInTheDocument()
})

it('keeps an unsent instruction and its key when the Map closes, and reports it as unsaved', async () => {
  const user = userEvent.setup()
  const processing = client(true)
  processing.chat.mockRejectedValueOnce(new Error('timeout'))
  const onDirtyChange = vi.fn()
  const first = render(
    <TellExamine batchId="kept" processing={processing} onDirtyChange={onDirtyChange} />,
  )
  await user.type(await screen.findByLabelText('Instruction for Examine'), 'Merge the reels')
  expect(onDirtyChange).toHaveBeenLastCalledWith(true)
  await user.click(screen.getByRole('button', { name: 'Tell Examine' }))
  await screen.findByRole('alert')
  first.unmount()

  render(<TellExamine batchId="kept" processing={processing} onDirtyChange={onDirtyChange} />)
  expect(await screen.findByLabelText('Instruction for Examine')).toHaveValue('Merge the reels')
  expect(onDirtyChange).toHaveBeenLastCalledWith(true)
  await user.click(screen.getByRole('button', { name: 'Tell Examine' }))
  await waitFor(() => expect(processing.chat).toHaveBeenCalledTimes(2))
  expect(processing.chat.mock.calls[1][3]).toBe(processing.chat.mock.calls[0][3])
  expect(onDirtyChange).toHaveBeenLastCalledWith(false)
})
