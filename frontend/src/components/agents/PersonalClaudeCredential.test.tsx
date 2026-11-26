import { afterEach, beforeEach, expect, it, vi, type Mock } from 'vitest'
import { act, fireEvent, render, screen } from '@testing-library/react'
import { deferred } from '#/test/deferred'
import { PersonalClaudeCredential } from './PersonalClaudeCredential'
import { KEY_PAUSE_MS } from './usePersonalClaudeCredential'

const TOKEN = 'sk-ant-oat01-abcdefghijklmnop'

let send: Mock<typeof fetch>
let onChanged: Mock<(configured: boolean | undefined) => void | Promise<boolean | void>>

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true })
  send = vi.fn<typeof fetch>()
  onChanged = vi.fn()
  vi.stubGlobal('isSecureContext', true)
  vi.stubGlobal('fetch', send)
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

const sent = () => send.mock.calls.map(([, request]) => JSON.parse(String(request?.body)))

const authorizations = () =>
  send.mock.calls.map(([, request]) => new Headers(request?.headers).get('authorization'))

function openDialog() {
  render(<PersonalClaudeCredential onChanged={onChanged} />)
  fireEvent.click(screen.getByRole('button', { name: 'Subscription token…' }))
  return screen.getByRole('dialog', { name: 'Claude subscription token' })
}

/** Types the key and waits past its pause, for the protected status read. */
async function enterKey(value = 'operator') {
  fireEvent.change(screen.getByLabelText('Personal runner management key'), {
    target: { value },
  })
  await act(() => vi.advanceTimersByTimeAsync(KEY_PAUSE_MS))
}

function typeToken(value: string) {
  fireEvent.change(screen.getByLabelText('Subscription token'), { target: { value } })
}

const save = () => screen.getByRole('button', { name: /Save token|Replace token|Saving…/ })

it('reads the protected status after the key is entered, then saves and closes once the VM confirms', async () => {
  send
    .mockResolvedValueOnce(Response.json({ configured: false, revision: 'one' }))
    .mockResolvedValueOnce(Response.json({ configured: true, revision: 'two' }))
  openDialog()
  expect(save()).toBeDisabled()
  await enterKey()
  expect(await screen.findByText('No token is saved.')).toBeVisible()
  expect(save()).toBeEnabled()
  typeToken(TOKEN)
  fireEvent.click(save())
  expect(save()).toBeDisabled()
  await act(() => vi.advanceTimersByTimeAsync(0))
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  expect(sent()).toEqual([{ action: 'status' }, { action: 'save', revision: 'one', token: TOKEN }])
  expect(onChanged).toHaveBeenCalledExactlyOnceWith(true)
})

it('an API key pasted as a token keeps the dialog open and sends nothing', async () => {
  send.mockResolvedValueOnce(Response.json({ configured: true, revision: 'one' }))
  openDialog()
  await enterKey()
  await screen.findByText('A token is saved.')
  typeToken('sk-ant-api03-abcdefghijklmnop')
  fireEvent.click(save())
  expect(screen.getByRole('alert')).toHaveTextContent(
    'That looks like an API key, not a subscription token',
  )
  expect(screen.getByRole('dialog')).toBeVisible()
  expect(sent()).toEqual([{ action: 'status' }])
  expect(onChanged).not.toHaveBeenCalled()
})

it('a wrong management key is refused with the reason, and Save and Remove stay disabled', async () => {
  send.mockResolvedValueOnce(new Response('{}', { status: 403 }))
  openDialog()
  await enterKey('wrong')
  expect(await screen.findByRole('alert')).toHaveTextContent('The management key was refused')
  expect(save()).toBeDisabled()
  expect(screen.queryByRole('button', { name: 'Remove token' })).not.toBeInTheDocument()
  expect(sent()).toEqual([{ action: 'status' }])
})

it('a token replaced elsewhere is refused as stale: the dialog stays open, says so and reads again', async () => {
  send
    .mockResolvedValueOnce(Response.json({ configured: true, revision: 'one' }))
    .mockResolvedValueOnce(new Response('{}', { status: 409 }))
    .mockResolvedValueOnce(Response.json({ configured: true, revision: 'three' }))
  openDialog()
  await enterKey()
  await screen.findByText('A token is saved.')
  typeToken(TOKEN)
  fireEvent.click(save())
  await act(() => vi.advanceTimersByTimeAsync(0))
  expect(screen.getByRole('dialog')).toBeVisible()
  expect(screen.getByRole('alert')).toHaveTextContent('The token changed since this dialog read it')
  expect(sent().map((body) => body.action)).toEqual(['status', 'save', 'status'])
  expect(save()).toBeEnabled()
  expect(onChanged).not.toHaveBeenCalled()
})

it('Remove closes once the VM confirms no token is stored', async () => {
  send
    .mockResolvedValueOnce(Response.json({ configured: true, revision: 'one' }))
    .mockResolvedValueOnce(Response.json({ configured: false, revision: 'two' }))
  openDialog()
  await enterKey()
  fireEvent.click(await screen.findByRole('button', { name: 'Remove token' }))
  await act(() => vi.advanceTimersByTimeAsync(0))
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  expect(sent()[1]).toEqual({ action: 'remove', revision: 'one' })
  expect(onChanged).toHaveBeenCalledExactlyOnceWith(false)
})

it('an unanswered save keeps the dialog open, never replays the token, and reads the status again', async () => {
  send
    .mockResolvedValueOnce(Response.json({ configured: false, revision: 'one' }))
    .mockRejectedValueOnce(new TypeError('network_failed'))
    .mockResolvedValueOnce(Response.json({ configured: false, revision: 'one' }))
  openDialog()
  await enterKey()
  await screen.findByText('No token is saved.')
  typeToken(TOKEN)
  fireEvent.click(save())
  await act(() => vi.advanceTimersByTimeAsync(0))
  expect(screen.getByRole('alert')).toHaveTextContent('didn’t confirm the change')
  expect(screen.getByRole('alert').textContent).not.toContain(TOKEN)
  expect(onChanged).toHaveBeenCalledExactlyOnceWith(undefined)
  expect(sent().map((body) => body.action)).toEqual(['status', 'save', 'status'])
  expect(send.mock.calls[2][1]?.body).not.toContain(TOKEN)
})

it('editing the key ends the read in flight, ignoring its answer, and reads with the new key', async () => {
  let answer: (value: Response) => void = () => undefined

  send
    .mockImplementationOnce(() => new Promise<Response>((resolve) => (answer = resolve)))
    .mockResolvedValueOnce(Response.json({ configured: false, revision: 'two' }))
  openDialog()
  await enterKey('first')
  await enterKey('second')
  await act(async () => answer(Response.json({ configured: true, revision: 'one' })))
  expect(await screen.findByText('No token is saved.')).toBeVisible()
  expect(authorizations()).toEqual(['Bearer first', 'Bearer second'])
})

it('closing drops the key: a reopened dialog starts empty and never sends the old key', async () => {
  send.mockResolvedValue(Response.json({ configured: false, revision: 'one' }))
  openDialog()
  await enterKey('old key')
  await screen.findByText('No token is saved.')
  fireEvent.click(screen.getByRole('button', { name: 'Close' }))
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: 'Subscription token…' }))
  expect(screen.getByLabelText('Personal runner management key')).toHaveValue('')
  expect(save()).toBeDisabled()
  await act(() => vi.advanceTimersByTimeAsync(KEY_PAUSE_MS * 2))
  await enterKey('new key')
  expect(authorizations()).toEqual(['Bearer old key', 'Bearer new key'])
})

it('closing during a save ignores its late answer, and the card reads the status again when it lands', async () => {
  let answer: (value: Response) => void = () => undefined

  send
    .mockResolvedValueOnce(Response.json({ configured: false, revision: 'one' }))
    .mockImplementationOnce(() => new Promise<Response>((resolve) => (answer = resolve)))
  openDialog()
  await enterKey()
  await screen.findByText('No token is saved.')
  typeToken(TOKEN)
  fireEvent.click(save())
  fireEvent.click(screen.getByRole('button', { name: 'Close' }))
  expect(onChanged).toHaveBeenCalledExactlyOnceWith(undefined)
  await act(async () => answer(Response.json({ configured: true, revision: 'two' })))
  // The late answer isn't shown, but the change it reports restarts the card's own read.
  expect(onChanged.mock.calls).toEqual([[undefined], [undefined, true]])
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
})

it('a request the VM never answers stops waiting and says so', async () => {
  send.mockImplementationOnce(
    (_url, init) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () =>
          reject(new DOMException('aborted', 'AbortError')),
        )
      }),
  )
  openDialog()
  await enterKey()
  expect(screen.getByText('Checking…')).toBeVisible()
  await act(() => vi.advanceTimersByTimeAsync(15_000))
  expect(await screen.findByRole('alert')).toHaveTextContent(
    'Couldn’t reach the Claude token service',
  )
})

it('a save whose answer is lost is unconfirmed: the card reads the VM again, and the token is not resent', async () => {
  send
    .mockResolvedValueOnce(Response.json({ configured: false, revision: 'one' }))
    .mockResolvedValueOnce(new Response('{}', { status: 502 }))
    .mockResolvedValueOnce(Response.json({ configured: true, revision: 'two' }))
  openDialog()
  await enterKey()
  await screen.findByText('No token is saved.')
  typeToken(TOKEN)
  fireEvent.click(save())
  await act(() => vi.advanceTimersByTimeAsync(0))
  expect(screen.getByRole('alert')).toHaveTextContent('didn’t confirm the change')
  expect(onChanged).toHaveBeenCalledExactlyOnceWith(undefined)
  expect(await screen.findByText('A token is saved.')).toBeVisible()
  expect(sent().map((body) => body.action)).toEqual(['status', 'save', 'status'])
})

it('a stale save stays reported when the reread fails, with Save still disabled', async () => {
  send
    .mockResolvedValueOnce(Response.json({ configured: true, revision: 'one' }))
    .mockResolvedValueOnce(new Response('{}', { status: 409 }))
    .mockResolvedValueOnce(new Response('{}', { status: 503 }))
  openDialog()
  await enterKey()
  await screen.findByText('A token is saved.')
  typeToken(TOKEN)
  fireEvent.click(save())
  await act(() => vi.advanceTimersByTimeAsync(0))
  const alerts = screen.getAllByRole('alert').map((alert) => alert.textContent)
  expect(alerts).toEqual([
    expect.stringContaining('The token changed since this dialog read it'),
    expect.stringContaining('Couldn’t reach the Claude token service'),
  ])
  expect(save()).toBeDisabled()
})

it('a confirmation still settling when the dialog is closed never closes it once reopened', async () => {
  send
    .mockResolvedValueOnce(Response.json({ configured: false, revision: 'one' }))
    .mockResolvedValueOnce(Response.json({ configured: true, revision: 'two' }))

  let settle: () => void = () => {}

  onChanged.mockImplementation(
    () =>
      new Promise<void>((resolve) => {
        settle = resolve
      }),
  )
  openDialog()
  await enterKey()
  fireEvent.change(screen.getByLabelText('Subscription token'), { target: { value: TOKEN } })
  fireEvent.click(screen.getByRole('button', { name: 'Save token' }))
  await act(() => vi.advanceTimersByTimeAsync(0))
  expect(onChanged).toHaveBeenCalledWith(true)
  fireEvent.click(screen.getByRole('button', { name: 'Close' }))
  fireEvent.click(screen.getByRole('button', { name: 'Subscription token…' }))
  await act(async () => settle())
  expect(screen.getByRole('dialog', { name: 'Claude subscription token' })).toBeVisible()
})

it('stays open to say the model list may be out of date when it couldn’t be marked', async () => {
  send
    .mockResolvedValueOnce(Response.json({ configured: false, revision: 'one' }))
    .mockResolvedValueOnce(Response.json({ configured: true, revision: 'two' }))
  onChanged.mockResolvedValue(false)
  openDialog()
  await enterKey()
  fireEvent.change(screen.getByLabelText('Subscription token'), { target: { value: TOKEN } })
  fireEvent.click(screen.getByRole('button', { name: 'Save token' }))
  expect(
    await screen.findByText(
      'Token saved. Claude’s model list may be out of date for up to a minute.',
    ),
  ).toBeVisible()
  expect(screen.getByRole('dialog', { name: 'Claude subscription token' })).toBeVisible()
  expect(onChanged).toHaveBeenCalledExactlyOnceWith(true)
  // The token it sent is cleared, so it can't be sent twice.
  expect(screen.getByLabelText('Subscription token')).toHaveValue('')
})

it('clears the saved token as soon as the VM stores it, even if the key is edited meanwhile', async () => {
  send
    .mockResolvedValueOnce(Response.json({ configured: false, revision: 'one' }))
    .mockResolvedValueOnce(Response.json({ configured: true, revision: 'two' }))
  const recording = new Promise<boolean>(() => {})
  onChanged.mockReturnValue(recording)
  openDialog()
  await enterKey()
  fireEvent.change(screen.getByLabelText('Subscription token'), { target: { value: TOKEN } })
  fireEvent.click(screen.getByRole('button', { name: 'Save token' }))
  await act(() => vi.advanceTimersByTimeAsync(0))
  expect(onChanged).toHaveBeenCalledExactlyOnceWith(true)
  fireEvent.change(screen.getByLabelText('Personal runner management key'), {
    target: { value: 'another' },
  })
  expect(screen.getByLabelText('Subscription token')).toHaveValue('')
})

it('keeps a replacement typed while the VM was storing the token', async () => {
  const stored = deferred<Response>()

  send
    .mockResolvedValueOnce(Response.json({ configured: false, revision: 'one' }))
    .mockReturnValueOnce(stored.promise)
  onChanged.mockReturnValue(new Promise<boolean>(() => {}))
  openDialog()
  await enterKey()
  fireEvent.change(screen.getByLabelText('Subscription token'), { target: { value: TOKEN } })
  fireEvent.click(screen.getByRole('button', { name: 'Save token' }))
  const replacement = 'sk-ant-oat01-zyxwvutsrqponmlk'
  fireEvent.change(screen.getByLabelText('Subscription token'), { target: { value: replacement } })
  await act(async () => stored.resolve(Response.json({ configured: true, revision: 'two' })))
  await act(() => vi.advanceTimersByTimeAsync(0))
  expect(onChanged).toHaveBeenCalledExactlyOnceWith(true)
  expect(screen.getByLabelText('Subscription token')).toHaveValue(replacement)
})
