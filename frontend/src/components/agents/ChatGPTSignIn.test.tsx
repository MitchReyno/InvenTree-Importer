import { afterEach, expect, it, vi } from 'vitest'
import { act, fireEvent, screen, waitFor } from '@testing-library/react'
import { focusManager } from '@tanstack/react-query'
import { createServerQueryClient } from '#/queries/client'
import { render } from '#/test/render'
import { ServerStateProvider } from '#/components/query/ServerStateProvider'
import { fixtureScope } from '#/test/render'
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

function challenge(loginId = 'device-1') {
  return Response.json({
    state: 'pending',
    loginId,
    userCode: 'TEST-CODE',
    verificationUrl: 'https://auth.openai.com/codex/device',
  })
}

async function startSignIn() {
  fireEvent.click(screen.getByText('ChatGPT subscription'))
  fireEvent.change(screen.getByLabelText('Codex runner management key'), {
    target: { value: 'key' },
  })
  fireEvent.click(screen.getByText('Sign in with ChatGPT'))
  expect(await screen.findByText('TEST-CODE')).toBeTruthy()
}

it('polls the pending sign-in until it connects, and only while the panel is open', async () => {
  vi.useFakeTimers({ shouldAdvanceTime: true })
  try {
    const send = vi
      .fn()
      .mockResolvedValueOnce(challenge())
      .mockResolvedValueOnce(challenge())
      .mockResolvedValueOnce(Response.json({ state: 'connected' }))
    vi.stubGlobal('isSecureContext', true)
    vi.stubGlobal('fetch', send)
    render(<ChatGPTSignIn />)
    await startSignIn()
    expect(send).toHaveBeenCalledTimes(1)
    await act(() => vi.advanceTimersByTimeAsync(3000))
    expect(JSON.parse(send.mock.calls[1][1].body)).toEqual({
      action: 'status',
      loginId: 'device-1',
    })
    await act(() => vi.advanceTimersByTimeAsync(3000))
    expect(await screen.findByText('Connected to ChatGPT')).toBeTruthy()
    await act(() => vi.advanceTimersByTimeAsync(9000))
    expect(send).toHaveBeenCalledTimes(3)
  } finally {
    vi.useRealTimers()
  }
})

it('stops polling when the panel closes, and a key edit drops an in-flight poll', async () => {
  vi.useFakeTimers({ shouldAdvanceTime: true })
  try {
    let answer: (value: Response) => void = () => undefined

    const send = vi
      .fn()
      .mockResolvedValueOnce(challenge())
      .mockImplementationOnce(() => new Promise<Response>((resolve) => (answer = resolve)))
    vi.stubGlobal('isSecureContext', true)
    vi.stubGlobal('fetch', send)
    render(<ChatGPTSignIn />)
    await startSignIn()
    await act(() => vi.advanceTimersByTimeAsync(3000))
    expect(send).toHaveBeenCalledTimes(2)
    fireEvent.change(screen.getByLabelText('Codex runner management key'), {
      target: { value: 'other key' },
    })
    await act(async () => answer(Response.json({ state: 'connected' })))
    expect(screen.queryByText('Connected to ChatGPT')).toBeNull()
    fireEvent.click(screen.getByText('ChatGPT subscription'))
    await act(() => vi.advanceTimersByTimeAsync(9000))
    expect(send).toHaveBeenCalledTimes(2)
  } finally {
    vi.useRealTimers()
  }
})

it('a failed poll stops polling and says the status is unconfirmed', async () => {
  vi.useFakeTimers({ shouldAdvanceTime: true })
  try {
    const send = vi
      .fn()
      .mockResolvedValueOnce(challenge())
      .mockResolvedValueOnce(new Response('nope', { status: 500 }))
    vi.stubGlobal('isSecureContext', true)
    vi.stubGlobal('fetch', send)
    render(<ChatGPTSignIn />)
    await startSignIn()
    await act(() => vi.advanceTimersByTimeAsync(3000))
    expect(await screen.findByRole('alert')).toHaveTextContent('Could not confirm sign-in status')
    await act(() => vi.advanceTimersByTimeAsync(9000))
    expect(send).toHaveBeenCalledTimes(2)
  } finally {
    vi.useRealTimers()
  }
})

it('app-wide reconciliation does not re-poll a finished sign-in', async () => {
  vi.useFakeTimers({ shouldAdvanceTime: true })
  try {
    const cache = createServerQueryClient()
    const send = vi
      .fn()
      .mockResolvedValueOnce(challenge())
      .mockResolvedValueOnce(Response.json({ state: 'connected' }))
      .mockResolvedValue(new Response('gone', { status: 404 }))
    vi.stubGlobal('isSecureContext', true)
    vi.stubGlobal('fetch', send)
    render(
      <ServerStateProvider scope={fixtureScope} client={cache}>
        <ChatGPTSignIn />
      </ServerStateProvider>,
    )
    await startSignIn()
    await act(() => vi.advanceTimersByTimeAsync(3000))
    expect(await screen.findByText('Connected to ChatGPT')).toBeTruthy()
    await act(async () => {
      await cache.invalidateQueries()
      await vi.advanceTimersByTimeAsync(10)
    })
    expect(send).toHaveBeenCalledTimes(2)
    expect(screen.getByText('Connected to ChatGPT')).toBeTruthy()
  } finally {
    vi.useRealTimers()
  }
})

it('app-wide reconciliation does not re-poll a failed sign-in', async () => {
  vi.useFakeTimers({ shouldAdvanceTime: true })
  try {
    const cache = createServerQueryClient()
    const send = vi
      .fn()
      .mockResolvedValueOnce(challenge())
      .mockResolvedValueOnce(new Response('nope', { status: 500 }))
      .mockResolvedValue(Response.json({ state: 'connected' }))
    vi.stubGlobal('isSecureContext', true)
    vi.stubGlobal('fetch', send)
    render(
      <ServerStateProvider scope={fixtureScope} client={cache}>
        <ChatGPTSignIn />
      </ServerStateProvider>,
    )
    await startSignIn()
    await act(() => vi.advanceTimersByTimeAsync(3000))
    expect(await screen.findByRole('alert')).toHaveTextContent('Could not confirm sign-in status')
    await act(async () => {
      await cache.invalidateQueries()
      await vi.advanceTimersByTimeAsync(10)
    })
    expect(send).toHaveBeenCalledTimes(2)
    expect(screen.getByRole('alert')).toHaveTextContent('Could not confirm sign-in status')
  } finally {
    vi.useRealTimers()
  }
})

it('a command waits for a status poll in flight, which the runner would refuse', async () => {
  vi.useFakeTimers({ shouldAdvanceTime: true })
  try {
    let answer: (value: Response) => void = () => undefined

    const send = vi
      .fn()
      .mockResolvedValueOnce(challenge())
      .mockImplementationOnce(() => new Promise<Response>((resolve) => (answer = resolve)))
      .mockResolvedValueOnce(Response.json({ state: 'disconnected' }))
    vi.stubGlobal('isSecureContext', true)
    vi.stubGlobal('fetch', send)
    render(<ChatGPTSignIn />)
    await startSignIn()
    await act(() => vi.advanceTimersByTimeAsync(3000))
    expect(send).toHaveBeenCalledTimes(2)
    fireEvent.click(screen.getByRole('button', { name: 'Cancel sign-in' }))
    await act(() => vi.advanceTimersByTimeAsync(10))
    expect(send).toHaveBeenCalledTimes(2)
    await act(async () => answer(challenge()))
    expect(await screen.findByText('Sign in with ChatGPT')).toBeTruthy()
    expect(send).toHaveBeenCalledTimes(3)
    expect(JSON.parse(send.mock.calls[2][1].body)).toEqual({
      action: 'cancel',
      loginId: 'device-1',
    })
  } finally {
    vi.useRealTimers()
  }
})

it('a poll that reconciliation cancels finishes before the next call starts', async () => {
  vi.useFakeTimers({ shouldAdvanceTime: true })
  try {
    const cache = createServerQueryClient()

    let answer: (value: Response) => void = () => undefined

    const send = vi
      .fn()
      .mockResolvedValueOnce(challenge())
      .mockImplementationOnce(() => new Promise<Response>((resolve) => (answer = resolve)))
      .mockImplementation(async () => challenge())
    vi.stubGlobal('isSecureContext', true)
    vi.stubGlobal('fetch', send)
    render(
      <ServerStateProvider scope={fixtureScope} client={cache}>
        <ChatGPTSignIn />
      </ServerStateProvider>,
    )
    await startSignIn()
    await act(() => vi.advanceTimersByTimeAsync(3000))
    expect(send).toHaveBeenCalledTimes(2)
    await act(async () => {
      await cache.cancelQueries()
      void cache.invalidateQueries()
      await vi.advanceTimersByTimeAsync(10)
    })
    expect(send).toHaveBeenCalledTimes(2)
    await act(async () => answer(challenge()))
    await waitFor(() => expect(send).toHaveBeenCalledTimes(3))
  } finally {
    vi.useRealTimers()
  }
})

it('a check after a key edit waits for the poll the edit dropped', async () => {
  vi.useFakeTimers({ shouldAdvanceTime: true })
  try {
    let answer: (value: Response) => void = () => undefined

    const send = vi
      .fn()
      .mockResolvedValueOnce(challenge())
      .mockImplementationOnce(() => new Promise<Response>((resolve) => (answer = resolve)))
      .mockResolvedValueOnce(Response.json({ state: 'connected' }))
    vi.stubGlobal('isSecureContext', true)
    vi.stubGlobal('fetch', send)
    render(<ChatGPTSignIn />)
    await startSignIn()
    await act(() => vi.advanceTimersByTimeAsync(3000))
    fireEvent.change(screen.getByLabelText('Codex runner management key'), {
      target: { value: 'other key' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Check ChatGPT connection' }))
    await act(() => vi.advanceTimersByTimeAsync(10))
    expect(send).toHaveBeenCalledTimes(2)
    await act(async () => answer(challenge()))
    expect(await screen.findByText('Connected to ChatGPT')).toBeTruthy()
    expect(send.mock.calls[2][1].headers.authorization).toBe('Bearer other key')
  } finally {
    vi.useRealTimers()
  }
})

it('keeps polling while the tab is hidden, since sign-in completes on the OpenAI tab', async () => {
  vi.useFakeTimers({ shouldAdvanceTime: true })
  focusManager.setFocused(false)
  try {
    const send = vi.fn().mockImplementation(async () => challenge())
    vi.stubGlobal('isSecureContext', true)
    vi.stubGlobal('fetch', send)
    render(<ChatGPTSignIn />)
    await startSignIn()
    await act(() => vi.advanceTimersByTimeAsync(6000))
    expect(send.mock.calls.length).toBeGreaterThanOrEqual(3)
  } finally {
    focusManager.setFocused(undefined)
    vi.useRealTimers()
  }
})

it('no status poll starts while a command is in flight', async () => {
  vi.useFakeTimers({ shouldAdvanceTime: true })
  try {
    let answer: (value: Response) => void = () => undefined

    const send = vi
      .fn()
      .mockResolvedValueOnce(challenge())
      .mockImplementationOnce(() => new Promise<Response>((resolve) => (answer = resolve)))
    vi.stubGlobal('isSecureContext', true)
    vi.stubGlobal('fetch', send)
    render(<ChatGPTSignIn />)
    await startSignIn()
    fireEvent.click(screen.getByText('Cancel sign-in'))
    await waitFor(() => expect(send).toHaveBeenCalledTimes(2))
    await act(() => vi.advanceTimersByTimeAsync(9000))
    expect(send).toHaveBeenCalledTimes(2)
    await act(async () => answer(Response.json({ state: 'disconnected' })))
    expect(await screen.findByText('Sign in with ChatGPT')).toBeTruthy()
  } finally {
    vi.useRealTimers()
  }
})
