import { useState } from 'react'
import { act, fireEvent, render, screen } from '@testing-library/react'
import { useQuery } from '@tanstack/react-query'
import { afterEach, expect, test, vi } from 'vitest'
import { LIVE_PROTOCOL } from '@invimport/contracts'
import { ServerStateProvider } from './components/query/ServerStateProvider'
import { createServerQueryClient } from './queries/client'
import { serverQueryKey } from './queries/scope'
import { fixtureScope } from './test/render'
import { LiveUpdates } from './components/operations/LiveUpdates'
import { useRetainedPollInterval } from './context'

class Socket {
  static instances: Socket[] = []
  onopen?: () => void
  onmessage?: (event: { data: string }) => void
  onclose?: (event: { code: number }) => void
  onerror?: () => void
  sent: string[] = []
  closed = false

  constructor(readonly url: URL) {
    Socket.instances.push(this)
  }

  send(value: string) {
    this.sent.push(value)
  }

  close(code?: number) {
    if (code !== undefined && code !== 1000 && (code < 3000 || code > 4999)) {
      throw new Error('invalid_browser_close_code')
    }
    this.closed = true
  }

  frame(value: unknown) {
    this.onmessage?.({ data: JSON.stringify(value) })
  }
}
const stream = '10000000-0000-4000-8000-000000000001'
const batch = '20000000-0000-4000-8000-000000000002'
const refreshBootstrap = vi.fn()

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
  Socket.instances = []
  refreshBootstrap.mockClear()
})

function setup(read = vi.fn(async () => 'Retained state')) {
  vi.useFakeTimers()
  vi.stubGlobal('WebSocket', Socket)
  const client = createServerQueryClient()

  function Probe() {
    const [draft, setDraft] = useState('Human draft')
    const interval = useRetainedPollInterval()
    const query = useQuery({
      queryKey: serverQueryKey(fixtureScope, 'manual', batch),
      queryFn: read,
      refetchInterval: interval,
    })
    return (
      <>
        <input
          aria-label="Human draft"
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
        />
        <span>{query.data}</span>
        <output aria-label="Poll interval">{String(interval)}</output>
      </>
    )
  }

  const view = render(
    <ServerStateProvider scope={fixtureScope} client={client}>
      <LiveUpdates csrfToken={'a'.repeat(64)} batchId={batch} refreshBootstrap={refreshBootstrap}>
        <Probe />
      </LiveUpdates>
    </ServerStateProvider>,
  )
  return { read, client, view, socket: Socket.instances[0] }
}

test('live invalidations suppress idle polling, preserve drafts and restore polling after disconnect', async () => {
  const { read, view, socket } = setup()
  await act(async () => {
    await vi.advanceTimersByTimeAsync(1)
  })
  fireEvent.change(screen.getByLabelText('Human draft'), {
    target: { value: 'Unsaved counted quantity' },
  })
  const nodeBuffer = globalThis.Buffer
  vi.stubGlobal('Buffer', undefined)
  act(() => {
    socket.onopen?.()
    socket.frame({
      type: 'ready',
      protocol: LIVE_PROTOCOL,
      cursors: [{ stream_id: stream, sequence: '9007199254740992' }],
      truncated: false,
    })
  })
  vi.stubGlobal('Buffer', nodeBuffer)
  expect(socket.url.search).toBe('')
  expect(JSON.parse(socket.sent[0]).csrf_token).toBe('a'.repeat(64))
  expect(screen.getByLabelText('Poll interval')).toHaveTextContent('false')
  await act(async () => {
    await vi.advanceTimersByTimeAsync(110)
  })
  const idleCount = read.mock.calls.length
  await act(async () => {
    await vi.advanceTimersByTimeAsync(10000)
  })
  expect(read).toHaveBeenCalledTimes(idleCount)
  act(() =>
    socket.frame({
      type: 'changed',
      protocol: LIVE_PROTOCOL,
      batch_id: batch,
      stream_id: stream,
      sequence: '9007199254740993',
      reset: false,
    }),
  )
  await act(async () => {
    await vi.advanceTimersByTimeAsync(110)
  })
  expect(read).toHaveBeenCalledTimes(idleCount + 1)
  expect(screen.getByLabelText('Human draft')).toHaveValue('Unsaved counted quantity')
  act(() => socket.onclose?.({ code: 1006 }))
  expect(refreshBootstrap).toHaveBeenCalledTimes(1)
  expect(screen.getByLabelText('Poll interval')).toHaveTextContent('2000')
  await act(async () => {
    await vi.advanceTimersByTimeAsync(1300)
  })
  const reconnect = Socket.instances[1]
  act(() => reconnect.onopen?.())
  expect(JSON.parse(reconnect.sent[0]).cursors[0].sequence).toBe('9007199254740993')
  expect(JSON.parse(reconnect.sent[0]).type).toBe('subscribe')
  expect(screen.getByLabelText('Human draft')).toHaveValue('Unsaved counted quantity')
  view.unmount()
  expect(reconnect.closed).toBe(true)
})

test('regressing or incompatible frames fail closed without replacing unsaved input or sending commands', async () => {
  const { socket, view } = setup()
  act(() => {
    socket.onopen?.()
    socket.frame({
      type: 'ready',
      protocol: LIVE_PROTOCOL,
      cursors: [{ stream_id: stream, sequence: '12' }],
      truncated: false,
    })
    socket.frame({
      type: 'changed',
      protocol: LIVE_PROTOCOL,
      batch_id: batch,
      stream_id: stream,
      sequence: '11',
      reset: false,
    })
  })
  expect(screen.getByText(/Application update required/)).toBeInTheDocument()
  expect(screen.getByLabelText('Human draft')).toHaveValue('Human draft')
  expect(socket.closed).toBe(true)
  expect(socket.sent).toHaveLength(1)
  await act(async () => {
    await vi.advanceTimersByTimeAsync(32000)
  })
  expect(Socket.instances).toHaveLength(1)
  view.unmount()
})

test('server restart requests new bootstrap authorization and truncated subscriptions retain bounded polling', () => {
  const { socket, view } = setup()
  act(() => socket.frame({ type: 'ready', protocol: LIVE_PROTOCOL, cursors: [], truncated: true }))
  expect(screen.getByLabelText('Poll interval')).toHaveTextContent('15000')
  act(() => socket.onclose?.({ code: 1012 }))
  expect(refreshBootstrap).toHaveBeenCalledTimes(1)
  expect(screen.getByLabelText('Poll interval')).toHaveTextContent('2000')
  view.unmount()
})

test('a live hint during the initial read forces a newer snapshot and ignores the old late result', async () => {
  let finishOld: (value: string) => void = () => {
    throw new Error('not_initialized')
  }

  const old = new Promise<string>((resolve) => {
    finishOld = resolve
  })
  const read = vi.fn(async () => 'Fresh snapshot').mockImplementationOnce(() => old)
  const { socket, view } = setup(read)
  await act(async () => {
    await vi.advanceTimersByTimeAsync(1)
  })
  expect(read).toHaveBeenCalledTimes(1)
  act(() =>
    socket.frame({
      type: 'ready',
      protocol: LIVE_PROTOCOL,
      cursors: [{ stream_id: stream, sequence: '12' }],
      truncated: false,
    }),
  )
  await act(async () => {
    await vi.advanceTimersByTimeAsync(110)
  })
  expect(read).toHaveBeenCalledTimes(2)
  expect(screen.getByText('Fresh snapshot')).toBeInTheDocument()
  await act(async () => {
    finishOld('Older initial snapshot')
    await vi.advanceTimersByTimeAsync(1)
  })
  expect(screen.queryByText('Older initial snapshot')).not.toBeInTheDocument()
  expect(screen.getByText('Fresh snapshot')).toBeInTheDocument()
  expect(screen.getByLabelText('Poll interval')).toHaveTextContent('false')
  view.unmount()
})

test('returning to the page reconciles retained reads, but a hidden page does not', async () => {
  const { read } = setup()
  await act(async () => {
    await vi.advanceTimersByTimeAsync(1)
  })
  expect(read).toHaveBeenCalledOnce()
  const visibility = vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden')
  await act(async () => {
    document.dispatchEvent(new Event('visibilitychange'))
    await vi.advanceTimersByTimeAsync(200)
  })
  expect(read).toHaveBeenCalledOnce()
  visibility.mockReturnValue('visible')
  await act(async () => {
    document.dispatchEvent(new Event('visibilitychange'))
    await vi.advanceTimersByTimeAsync(200)
  })
  expect(read).toHaveBeenCalledTimes(2)
  // Focus and visibility arriving together coalesce into one reconciliation.
  await act(async () => {
    window.dispatchEvent(new Event('focus'))
    document.dispatchEvent(new Event('visibilitychange'))
    await vi.advanceTimersByTimeAsync(200)
  })
  expect(read).toHaveBeenCalledTimes(3)
  visibility.mockRestore()
})
