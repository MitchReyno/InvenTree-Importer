import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { expect, it, vi } from 'vitest'
import type { ProcessingClient } from '../../processing/types'
import { render } from '../../test/render'
import { TellExamine } from './TellExamine'

const snapshot = (session: boolean) => ({
  jobs: [
    {
      id: 'lead',
      stage: 'examine',
      subject_id: null,
      ...(session ? { session_state: 'running' } : {}),
    },
  ],
})

function client(session: boolean) {
  return {
    read: vi.fn(async () => snapshot(session)),
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
  expect(await screen.findByRole('status')).toHaveTextContent('Sent to Examine')
  expect(screen.getByLabelText('Instruction for Examine')).toHaveValue('')
})

it('keeps the instruction when it is not accepted', async () => {
  const user = userEvent.setup()
  const processing = client(true)
  processing.chat.mockRejectedValueOnce(new Error('refused'))
  render(<TellExamine batchId="b" processing={processing} />)
  await user.type(await screen.findByLabelText('Instruction for Examine'), 'Merge them')
  await user.click(screen.getByRole('button', { name: 'Tell Examine' }))

  expect(await screen.findByRole('alert')).toHaveTextContent('not sent')
  expect(screen.getByLabelText('Instruction for Examine')).toHaveValue('Merge them')
})

it('shows no instruction field without an Examine session', async () => {
  const processing = client(false)
  render(<TellExamine batchId="b" processing={processing} />)
  await waitFor(() => expect(processing.read).toHaveBeenCalled())
  expect(screen.queryByLabelText('Instruction for Examine')).not.toBeInTheDocument()
})
