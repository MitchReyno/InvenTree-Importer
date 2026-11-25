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

it('keeps line breaks in a message', async () => {
  const onSend = vi.fn()
  render(<SessionChat messages={[]} onSend={onSend} />)
  await userEvent.type(
    screen.getByRole('textbox', { name: 'Message' }),
    'Row 1{Shift>}{Enter}{/Shift}Row 2',
  )
  await userEvent.click(screen.getByRole('button', { name: 'Send' }))
  expect(onSend).toHaveBeenCalledWith('Row 1\nRow 2')
})

describe('the message box', () => {
  it('is labelled for its step, with a placeholder and a hint tied to it', () => {
    render(<SessionChat messages={[]} onSend={vi.fn()} label="Message Research" showLog={false} />)
    const box = screen.getByRole('textbox', { name: 'Message Research' })

    expect(screen.getByText('Message Research')).toBeVisible()
    expect(box).toHaveAttribute('placeholder', 'Ask why, or tell it what to check next')
    expect(box).toHaveAccessibleDescription('Enter to send · Shift+Enter for a new line')
  })

  it('sends once on Enter, and Send is unavailable while the box is empty', async () => {
    const onSend = vi.fn()
    render(<SessionChat messages={[]} onSend={onSend} label="Message Research" showLog={false} />)
    const box = screen.getByRole('textbox', { name: 'Message Research' })

    expect(screen.getByRole('button', { name: 'Send' })).toBeDisabled()
    await userEvent.type(box, '{Enter}')
    expect(onSend).not.toHaveBeenCalled()

    await userEvent.type(box, 'Check the date code{Enter}')
    expect(onSend).toHaveBeenCalledTimes(1)
    expect(onSend).toHaveBeenCalledWith('Check the date code')
    expect(box).toHaveValue('')
  })

  it('does not send on Enter while sending is held', async () => {
    const onSend = vi.fn()
    render(<SessionChat messages={[]} onSend={onSend} sendDisabled showLog={false} />)
    const box = screen.getByRole('textbox', { name: 'Message' })

    await userEvent.type(box, 'Wait{Enter}')
    expect(onSend).not.toHaveBeenCalled()
    expect(box).toHaveValue('Wait')
  })
})
