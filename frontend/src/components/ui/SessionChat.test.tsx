import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { SessionChat } from './SessionChat'

const messages = [
  { id: 'm1', who: 'Examine', text: 'Is the blue reel part of lot 2?', mine: false },
  { id: 'm2', who: 'You', text: 'Yes', mine: true },
]

describe('SessionChat', () => {
  it('shows the conversation as a log and sends a trimmed message', async () => {
    const onSend = vi.fn()
    render(<SessionChat messages={messages} onSend={onSend} />)

    expect(screen.getByRole('log', { name: 'Session messages' })).toHaveTextContent(
      'Is the blue reel',
    )
    await userEvent.type(screen.getByRole('textbox', { name: 'Message' }), '  Use the label  ')
    await userEvent.click(screen.getByRole('button', { name: 'Send' }))
    expect(onSend).toHaveBeenCalledWith('Use the label')
    expect(screen.getByRole('textbox', { name: 'Message' })).toHaveValue('')
  })

  it('does not send empty messages and disables the composer for a cancelled session', async () => {
    const onSend = vi.fn()
    const { rerender } = render(<SessionChat messages={messages} onSend={onSend} />)

    await userEvent.click(screen.getByRole('button', { name: 'Send' }))
    expect(onSend).not.toHaveBeenCalled()

    rerender(<SessionChat messages={messages} onSend={onSend} disabled />)
    expect(screen.getByRole('textbox', { name: 'Message' })).toBeDisabled()
    expect(screen.getByText('This session was cancelled, so it can’t take messages.')).toBeVisible()
  })
})
