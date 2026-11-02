import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import {
  LIVE_PROTOCOL,
  validate,
  type LiveCursorDto,
  type LiveFrameDto,
} from '@invimport/contracts'
import { strictJson } from '@invimport/contracts/json'
import { RETAINED_POLL_INTERVAL_MS } from '../queries/client'
import { serverQueryKey, ServerScopeContext } from '../queries/scope'
import { Small } from '../components/ui/primitives'

const PollInterval = createContext<number | false>(RETAINED_POLL_INTERVAL_MS)

export function useRetainedPollInterval() {
  return useContext(PollInterval)
}

type Connection = 'connecting' | 'live' | 'polling' | 'update_required'
interface Props {
  csrfToken: string | null
  batchId: string | null
  refreshBootstrap: () => void
  children: ReactNode
}

/** Socket frames invalidate reads only. Drafts and domain command lifecycles stay with their owners. */
export function LiveUpdates({ csrfToken, batchId, refreshBootstrap, children }: Props) {
  const scope = useContext(ServerScopeContext)
  const queryClient = useQueryClient()
  const [connection, setConnection] = useState<Connection>('connecting')
  const [truncated, setTruncated] = useState(false)
  const cursors = useRef<LiveCursorDto[]>([])
  useEffect(() => {
    if (!scope) {
      return
    }
    let stopped = false
    let socket: WebSocket | undefined
    let retry: ReturnType<typeof setTimeout> | undefined
    let deadline: ReturnType<typeof setInterval> | undefined
    let invalidate: ReturnType<typeof setTimeout> | undefined
    let attempt = 0
    let lastFrame = Date.now()

    const reconcile = () => {
      if (stopped || invalidate !== undefined) {
        return
      }
      invalidate = setTimeout(() => {
        invalidate = undefined
        void queryClient.invalidateQueries({ queryKey: serverQueryKey(scope) })
      }, 100)
    }

    const connect = () => {
      if (stopped || !csrfToken || typeof WebSocket === 'undefined') {
        setConnection('polling')
        return
      }
      setConnection('connecting')
      try {
        const url = new URL('/api/v1/live', scope.origin)
        url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:'
        socket = new WebSocket(url)
      } catch {
        schedule()
        return
      }
      const current = socket
      lastFrame = Date.now()
      current.onopen = () => {
        if (stopped) {
          current.close()
          return
        }
        current.send(
          JSON.stringify({
            type: 'subscribe',
            protocol: LIVE_PROTOCOL,
            csrf_token: csrfToken,
            batch_id: batchId,
            cursors: cursors.current,
          }),
        )
      }
      current.onmessage = (event) => {
        if (stopped) {
          return
        }
        try {
          if (typeof event.data !== 'string' || event.data.length > 65536) {
            throw new Error('invalid_frame')
          }
          const value = strictJson(event.data)
          validate('LiveFrame', value)
          const frame = value as LiveFrameDto
          lastFrame = Date.now()
          if (frame.type === 'ready') {
            if (
              new Set(frame.cursors.map((cursor) => cursor.stream_id)).size !== frame.cursors.length
            ) {
              throw new Error('duplicate_cursor')
            }
            cursors.current = frame.cursors
            setTruncated(frame.truncated)
            setConnection('live')
            attempt = 0
            reconcile()
          } else if (frame.type === 'changed') {
            const previous = cursors.current.find((cursor) => cursor.stream_id === frame.stream_id)
            if (!previous || BigInt(frame.sequence) < BigInt(previous.sequence)) {
              throw new Error('cursor_regressed')
            }
            previous.sequence = frame.sequence
            reconcile()
          }
        } catch {
          setConnection('update_required')
          stopped = true
          clearInterval(deadline)
          current.close(3002, 'invalid_frame')
        }
      }
      current.onerror = () => current.close()
      current.onclose = (event) => {
        if (stopped) {
          return
        }
        clearInterval(deadline)
        if (event.code === 1002) {
          setConnection('update_required')
          stopped = true
          return
        }
        refreshBootstrap()
        schedule()
      }
      deadline = setInterval(() => {
        if (Date.now() - lastFrame > 30000) {
          current.close()
        }
      }, 5000)
    }

    const schedule = () => {
      if (stopped) {
        return
      }
      setConnection('polling')
      clearTimeout(retry)
      retry = setTimeout(
        connect,
        Math.min(30000, 1000 * 2 ** Math.min(attempt++, 5)) + Math.random() * 250,
      )
    }

    const focus = () => {
      reconcile()
    }

    window.addEventListener('focus', focus)
    window.addEventListener('online', focus)
    connect()
    return () => {
      stopped = true
      clearTimeout(retry)
      clearTimeout(invalidate)
      clearInterval(deadline)
      window.removeEventListener('focus', focus)
      window.removeEventListener('online', focus)
      socket?.close()
    }
  }, [scope, csrfToken, batchId, queryClient, refreshBootstrap])
  let status = 'Connecting live updates…'
  if (connection === 'live') {
    status = 'Live updates connected'
  }
  if (connection === 'polling') {
    status = 'Live updates unavailable; checking saved state periodically'
  }
  if (connection === 'update_required') {
    status = 'Application update required. Save or discard unsaved work before reloading.'
  }
  const interval = connection === 'live' ? (truncated ? 15000 : false) : RETAINED_POLL_INTERVAL_MS
  return (
    <PollInterval.Provider value={interval}>
      {csrfToken && (
        <Small role="status" aria-live="polite">
          {status}
        </Small>
      )}
      {children}
    </PollInterval.Provider>
  )
}
