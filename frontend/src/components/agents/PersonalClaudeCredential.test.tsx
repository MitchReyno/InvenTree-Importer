import { afterEach, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { PersonalClaudeCredential } from './PersonalClaudeCredential'

afterEach(() => vi.unstubAllGlobals())

it('saves only on explicit submit and clears the password after the guest acknowledges', async () => {
  const send = vi
    .fn()
    .mockResolvedValueOnce(Response.json({ configured: false, revision: 'one' }))
    .mockResolvedValueOnce(Response.json({ configured: true, revision: 'two' }))
    .mockResolvedValueOnce(new Response(null, { status: 503 }))
  vi.stubGlobal('isSecureContext', true)
  vi.stubGlobal('fetch', send)
  render(<PersonalClaudeCredential />)
  fireEvent.click(screen.getByText('Personal Claude subscription'))
  fireEvent.change(screen.getByLabelText('Personal runner management key'), {
    target: { value: 'operator' },
  })
  fireEvent.click(screen.getByText('Check configuration'))
  const field = (await screen.findByLabelText('CLAUDE_CODE_OAUTH_TOKEN')) as HTMLInputElement
  expect(field.type).toBe('password')
  fireEvent.change(field, { target: { value: 'secret-sentinel' } })
  expect(send).toHaveBeenCalledTimes(1)
  fireEvent.click(screen.getByText('Save token'))
  await screen.findByText('Configured')
  expect(field.value).toBe('')
  expect(JSON.parse(send.mock.calls[1][1].body)).toEqual({
    action: 'save',
    revision: 'one',
    token: 'secret-sentinel',
  })
  fireEvent.click(screen.getByText('Remove token'))
  await screen.findByRole('alert')
  expect(JSON.parse(send.mock.calls[2][1].body)).toEqual({ action: 'remove', revision: 'two' })
})

it('discards an unconfirmed offline save and reconnects without replaying the secret', async () => {
  const sentinel = 'fixture-offline-token'
  const send = vi
    .fn()
    .mockResolvedValueOnce(Response.json({ configured: false, revision: 'first' }))
    .mockRejectedValueOnce(new Error(sentinel))
    .mockResolvedValueOnce(Response.json({ configured: false, revision: 'first' }))
  vi.stubGlobal('isSecureContext', true)
  vi.stubGlobal('fetch', send)
  render(<PersonalClaudeCredential />)
  fireEvent.click(screen.getByText('Personal Claude subscription'))
  fireEvent.click(screen.getByText('Check configuration'))
  fireEvent.change(await screen.findByLabelText('CLAUDE_CODE_OAUTH_TOKEN'), {
    target: { value: sentinel },
  })
  fireEvent.click(screen.getByText('Save token'))
  expect((await screen.findByRole('alert')).textContent).not.toContain(sentinel)
  expect(screen.queryByLabelText('CLAUDE_CODE_OAUTH_TOKEN')).toBeNull()
  fireEvent.click(screen.getByText('Check configuration'))
  const field = (await screen.findByLabelText('CLAUDE_CODE_OAUTH_TOKEN')) as HTMLInputElement
  expect(field.value).toBe('')
  expect(send.mock.calls.map(([, request]) => JSON.parse(request.body).action)).toEqual([
    'status',
    'save',
    'status',
  ])
  expect(send.mock.calls[2][1].body).not.toContain(sentinel)
})
