import { afterEach, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { ChatGPTSignIn } from './ChatGPTSignIn'
afterEach(() => vi.unstubAllGlobals())
it('displays the guest device challenge and cancels only its login', async () => {
  const send = vi
    .fn()
    .mockResolvedValueOnce(
      Response.json({
        state: 'pending',
        loginId: 'device-1',
        userCode: 'TEST-CODE',
        verificationUrl: 'https://auth.openai.com/codex/device',
      }),
    )
    .mockResolvedValueOnce(Response.json({ state: 'disconnected' }))
  vi.stubGlobal('isSecureContext', true)
  vi.stubGlobal('fetch', send)
  render(<ChatGPTSignIn />)
  fireEvent.click(screen.getByText('ChatGPT subscription'))
  fireEvent.change(screen.getByLabelText('Codex runner management key'), {
    target: { value: 'key' },
  })
  fireEvent.click(screen.getByText('Sign in with ChatGPT'))
  expect(await screen.findByText('TEST-CODE')).toBeTruthy()
  expect(
    screen.getByRole('link', { name: 'OpenAI device verification' }).getAttribute('href'),
  ).toBe('https://auth.openai.com/codex/device')
  fireEvent.click(screen.getByText('Cancel sign-in'))
  await screen.findByText('Sign in with ChatGPT')
  expect(JSON.parse(send.mock.calls[1][1].body)).toEqual({ action: 'cancel', loginId: 'device-1' })
})
