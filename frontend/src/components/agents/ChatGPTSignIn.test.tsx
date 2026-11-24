import { afterEach, beforeEach, expect, it, vi, type Mock } from 'vitest'
import { act, fireEvent, screen, waitFor } from '@testing-library/react'
import { focusManager } from '@tanstack/react-query'
import { createServerQueryClient } from '#/queries/client'
import { render } from '#/test/render'
import { ChatGPTSignIn } from './ChatGPTSignIn'
import { KEY_PAUSE_MS } from './usePersonalClaudeCredential'
import { resetRunnerQueue } from './useChatGPTSignIn'

let send: Mock<typeof fetch>
let onConfirmed: Mock<() => void>
let onChanged: Mock<() => void>

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true })
  send = vi.fn<typeof fetch>()
  onConfirmed = vi.fn()
  onChanged = vi.fn()
  vi.stubGlobal('isSecureContext', true)
  vi.stubGlobal('fetch', send)
})

afterEach(() => {
  resetRunnerQueue()
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

function challenge(loginId = 'device-1') {
  return Response.json({
    state: 'pending',
    loginId,
    userCode: 'TEST-CODE',
    verificationUrl: 'https://auth.openai.com/codex/device',
  })
}

const signedOut = () => Response.json({ state: 'disconnected' })

const sent = () => send.mock.calls.map(([, request]) => JSON.parse(String(request?.body)))

const authorizations = () =>
  send.mock.calls.map(([, request]) => new Headers(request?.headers).get('authorization'))

async function wait(ms = 0) {
  await act(() => vi.advanceTimersByTimeAsync(ms))
}

function openDialog(cache = createServerQueryClient()) {
  render(<ChatGPTSignIn onConfirmed={onConfirmed} onChanged={onChanged} />, { cache })
  fireEvent.click(screen.getByRole('button', { name: 'Sign in to ChatGPT…' }))
  return cache
}

const close = () => fireEvent.click(screen.getByRole('button', { name: 'Close' }))

async function enterKey(value = 'key') {
  fireEvent.change(screen.getByLabelText('Codex runner management key'), { target: { value } })
  await wait(KEY_PAUSE_MS)
}

/** Opens the dialog, reads the status with the key, and starts a sign-in. */
async function startSignIn(cache?: ReturnType<typeof createServerQueryClient>) {
  send.mockResolvedValueOnce(signedOut()).mockResolvedValueOnce(challenge())
  openDialog(cache)
  await enterKey()
  fireEvent.click(await screen.findByRole('button', { name: 'Sign in with ChatGPT' }))
  expect(await screen.findByText('TEST-CODE')).toBeVisible()
}

it('commands wait for the protected status read with the key', async () => {
  send.mockResolvedValueOnce(signedOut())
  openDialog()
  expect(screen.queryByRole('button', { name: 'Sign in with ChatGPT' })).not.toBeInTheDocument()
  await enterKey()
  expect(await screen.findByRole('button', { name: 'Sign in with ChatGPT' })).toBeEnabled()
  expect(sent()).toEqual([{ action: 'status' }])
})

it('shows the device challenge and cancels only its login', async () => {
  await startSignIn()
  expect(
    screen.getByRole('link', { name: 'OpenAI device verification' }).getAttribute('href'),
  ).toBe('https://auth.openai.com/codex/device')
  send.mockResolvedValueOnce(signedOut())
  fireEvent.click(screen.getByRole('button', { name: 'Cancel sign-in' }))
  await screen.findByRole('button', { name: 'Sign in with ChatGPT' })
  expect(sent().at(-1)).toEqual({ action: 'cancel', loginId: 'device-1' })
})

it('closes by itself once a poll confirms the account', async () => {
  await startSignIn()
  send
    .mockResolvedValueOnce(challenge())
    .mockResolvedValueOnce(Response.json({ state: 'connected' }))
  await wait(3000)
  expect(sent().at(-1)).toEqual({ action: 'status', loginId: 'device-1' })
  expect(screen.getByRole('dialog')).toBeVisible()
  await wait(3000)
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  expect(onConfirmed).toHaveBeenCalledTimes(1)
  await wait(9000)
  expect(send).toHaveBeenCalledTimes(4)
})

it('an account already signed in is shown, not closed', async () => {
  send.mockResolvedValueOnce(Response.json({ state: 'connected' }))
  openDialog()
  await enterKey()
  expect(await screen.findByText('Signed in to ChatGPT')).toBeVisible()
  expect(onConfirmed).not.toHaveBeenCalled()
})

it('closing mid-sign-in makes one final poll, cancels the pending login and has the card read again', async () => {
  await startSignIn()
  send.mockResolvedValueOnce(challenge()).mockResolvedValueOnce(signedOut())
  onChanged.mockClear()
  close()
  expect(onChanged).toHaveBeenCalledTimes(1)
  await wait()
  expect(sent().slice(2)).toEqual([
    { action: 'status', loginId: 'device-1' },
    { action: 'cancel', loginId: 'device-1' },
  ])
  expect(onChanged).toHaveBeenCalledTimes(2)
  await wait(9000)
  expect(send).toHaveBeenCalledTimes(4)
})

it('the final poll completes a login already approved, with nothing to cancel', async () => {
  await startSignIn()
  send.mockResolvedValueOnce(Response.json({ state: 'connected' }))
  close()
  await wait()
  expect(sent().slice(2)).toEqual([{ action: 'status', loginId: 'device-1' }])
})

it('closing with a call queued drops it unsent; reopening with a new key holds only that key', async () => {
  let answer: (value: Response) => void = () => undefined

  await startSignIn()
  // A poll is running, so every later call waits behind it in the queue.
  send.mockImplementationOnce(() => new Promise<Response>((resolve) => (answer = resolve)))
  await wait(3000)
  expect(send).toHaveBeenCalledTimes(3)
  close()
  send
    .mockResolvedValueOnce(challenge())
    .mockResolvedValueOnce(signedOut())
    .mockResolvedValueOnce(signedOut())
  fireEvent.click(screen.getByRole('button', { name: 'Sign in to ChatGPT…' }))
  expect(screen.getByLabelText('Codex runner management key')).toHaveValue('')
  // Its status read queues behind the old poll; a second key ends it before it is sent.
  await enterKey('first try')
  await enterKey('new key')
  // The old poll answers late; it changes nothing in the new dialog.
  await act(async () => answer(Response.json({ state: 'connected' })))
  await wait()
  expect(onConfirmed).not.toHaveBeenCalled()
  expect(sent().slice(3)).toEqual([
    { action: 'status', loginId: 'device-1' },
    { action: 'cancel', loginId: 'device-1' },
    { action: 'status' },
  ])
  expect(authorizations()).toEqual([...Array(5).fill('Bearer key'), 'Bearer new key'])
  expect(await screen.findByRole('button', { name: 'Sign in with ChatGPT' })).toBeVisible()
})

it('editing the key while signing in stops the poll, ignores its late answer and finishes the old login', async () => {
  let answer: (value: Response) => void = () => undefined

  await startSignIn()
  send.mockImplementationOnce(() => new Promise<Response>((resolve) => (answer = resolve)))
  await wait(3000)
  expect(send).toHaveBeenCalledTimes(3)
  send
    .mockResolvedValueOnce(challenge())
    .mockResolvedValueOnce(signedOut())
    .mockResolvedValueOnce(signedOut())
  await enterKey('other key')
  await act(async () => answer(Response.json({ state: 'connected' })))
  await wait(9000)
  expect(onConfirmed).not.toHaveBeenCalled()
  expect(screen.queryByText('Signed in to ChatGPT')).not.toBeInTheDocument()
  expect(sent().slice(3)).toEqual([
    { action: 'status', loginId: 'device-1' },
    { action: 'cancel', loginId: 'device-1' },
    { action: 'status' },
  ])
  expect(authorizations().slice(3)).toEqual(['Bearer key', 'Bearer key', 'Bearer other key'])
  expect(send).toHaveBeenCalledTimes(6)
})

it('closing after a start whose answer was lost finds the pending login and cancels it', async () => {
  send.mockResolvedValueOnce(signedOut())
  openDialog()
  await enterKey()
  send.mockRejectedValueOnce(new TypeError('network_failed'))
  fireEvent.click(await screen.findByRole('button', { name: 'Sign in with ChatGPT' }))
  expect(await screen.findByRole('alert')).toHaveTextContent('Could not confirm sign-in status')
  send
    .mockResolvedValueOnce(challenge())
    .mockResolvedValueOnce(challenge())
    .mockResolvedValueOnce(signedOut())
  close()
  await wait()
  expect(sent()).toEqual([
    { action: 'status' },
    { action: 'start' },
    { action: 'status' },
    { action: 'status', loginId: 'device-1' },
    { action: 'cancel', loginId: 'device-1' },
  ])
})

it('a failed poll stops polling and says the status is unconfirmed', async () => {
  await startSignIn()
  send.mockResolvedValueOnce(new Response('nope', { status: 500 }))
  await wait(3000)
  expect(await screen.findByRole('alert')).toHaveTextContent('Could not confirm sign-in status')
  await wait(9000)
  expect(send).toHaveBeenCalledTimes(3)
})

it('app-wide reconciliation does not re-poll a failed sign-in', async () => {
  const cache = createServerQueryClient()
  await startSignIn(cache)
  send
    .mockResolvedValueOnce(new Response('nope', { status: 500 }))
    .mockResolvedValue(Response.json({ state: 'connected' }))
  await wait(3000)
  expect(await screen.findByRole('alert')).toHaveTextContent('Could not confirm sign-in status')
  await act(async () => {
    await cache.invalidateQueries()
    await vi.advanceTimersByTimeAsync(10)
  })
  expect(send).toHaveBeenCalledTimes(3)
})

it('a poll that reconciliation cancels and replays adopts the call still running', async () => {
  let answer: (value: Response) => void = () => undefined

  const cache = createServerQueryClient()
  await startSignIn(cache)
  send
    .mockImplementationOnce(() => new Promise<Response>((resolve) => (answer = resolve)))
    .mockImplementation(async () => new Response('busy', { status: 409 }))
  await wait(3000)
  expect(send).toHaveBeenCalledTimes(3)
  await act(async () => {
    await cache.cancelQueries()
    void cache.invalidateQueries()
    await vi.advanceTimersByTimeAsync(10)
  })
  await act(async () => answer(Response.json({ state: 'denied' })))
  expect(await screen.findByText('Sign-in was declined or expired.')).toBeVisible()
  expect(screen.queryByRole('alert')).toBeNull()
  expect(send).toHaveBeenCalledTimes(3)
})

it('keeps polling while the tab is hidden, since sign-in completes on the OpenAI tab', async () => {
  focusManager.setFocused(false)
  try {
    await startSignIn()
    send.mockImplementation(async () => challenge())
    await wait(6000)
    expect(send.mock.calls.length).toBeGreaterThanOrEqual(4)
  } finally {
    focusManager.setFocused(undefined)
  }
})

it('commands wait for this login’s poll, which can end the login', async () => {
  let answer: (value: Response) => void = () => undefined

  await startSignIn()
  send.mockImplementationOnce(() => new Promise<Response>((resolve) => (answer = resolve)))
  await wait(3000)
  await waitFor(() => expect(screen.getByRole('button', { name: 'Cancel sign-in' })).toBeDisabled())
  await act(async () => answer(Response.json({ state: 'denied' })))
  expect(await screen.findByText('Sign-in was declined or expired.')).toBeVisible()
  expect(screen.getByRole('button', { name: 'Sign in with ChatGPT' })).toBeEnabled()
  expect(send).toHaveBeenCalledTimes(3)
})

it('closing a reopened dialog while its first read waits in the queue never sends that read', async () => {
  let answer: (value: Response) => void = () => undefined

  await startSignIn()
  send.mockImplementationOnce(() => new Promise<Response>((resolve) => (answer = resolve)))
  await wait(3000)
  close()
  send.mockResolvedValueOnce(challenge()).mockResolvedValueOnce(signedOut())
  fireEvent.click(screen.getByRole('button', { name: 'Sign in to ChatGPT…' }))
  await enterKey('second key')
  close()
  await act(async () => answer(challenge()))
  await wait()
  expect(sent().slice(3)).toEqual([
    { action: 'status', loginId: 'device-1' },
    { action: 'cancel', loginId: 'device-1' },
  ])
  expect(authorizations()).not.toContain('Bearer second key')
})

it('closing while a start is still unanswered finishes the login it creates', async () => {
  let answer: (value: Response) => void = () => undefined

  send.mockResolvedValueOnce(signedOut())
  openDialog()
  await enterKey()
  send.mockImplementationOnce(() => new Promise<Response>((resolve) => (answer = resolve)))
  fireEvent.click(await screen.findByRole('button', { name: 'Sign in with ChatGPT' }))
  await wait()
  close()
  send.mockResolvedValueOnce(challenge()).mockResolvedValueOnce(signedOut())
  await act(async () => answer(challenge()))
  await wait()
  expect(sent()).toEqual([
    { action: 'status' },
    { action: 'start' },
    { action: 'status', loginId: 'device-1' },
    { action: 'cancel', loginId: 'device-1' },
  ])
})

it('a sign-in that is declined or expires has the card read the VM again', async () => {
  await startSignIn()
  onChanged.mockClear()
  send.mockResolvedValueOnce(Response.json({ state: 'denied' }))
  await wait(3000)
  expect(await screen.findByText('Sign-in was declined or expired.')).toBeVisible()
  expect(onChanged).toHaveBeenCalledTimes(1)
  expect(onConfirmed).not.toHaveBeenCalled()
})

it('the challenge leaves the query cache once the dialog closes', async () => {
  const cache = createServerQueryClient()
  await startSignIn(cache)
  send.mockResolvedValueOnce(challenge()).mockResolvedValueOnce(signedOut())
  close()
  await wait()
  const held = cache
    .getQueryCache()
    .getAll()
    .filter((query) => JSON.stringify(query.queryKey).includes('codex-login'))
  expect(held).toEqual([])
  expect(
    JSON.stringify(
      cache
        .getQueryCache()
        .getAll()
        .map((query) => query.state.data),
    ),
  ).not.toContain('TEST-CODE')
})
