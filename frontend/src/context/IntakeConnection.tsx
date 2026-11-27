import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import { intakeClient } from '@invimport/contracts/client'
import { useOnForeground } from '#/browser/useOnForeground'
import { useUpdateHealth } from './LiveUpdatesContext'

type Contact = 'checking' | 'connected' | 'degraded' | 'disconnected'
interface Observation {
  contact: Contact
  recoveredAt: number
  bootstrapFailed: boolean
  confirm: () => void
}

const Context = createContext<Observation | null>(null)
const HEALTHY_MS = 10_000

export function useIntakeConnection() {
  return useContext(Context)
}

const readHealth = () => intakeClient(location.origin).health()

export function IntakeConnectionProvider({
  read = readHealth,
  bootstrapFailed,
  refreshBootstrap,
  children,
}: {
  bootstrapFailed: boolean
  refreshBootstrap: () => void
  children: ReactNode
  read?: () => Promise<unknown>
}) {
  const socket = useUpdateHealth()
  const liveAt = socket.state === 'live' ? (socket.observedAt ?? 0) : 0
  const [observation, setObservation] = useState<Pick<Observation, 'contact' | 'recoveredAt'>>({
    contact: 'checking',
    recoveredAt: 0,
  })
  const latest = useRef({ liveAt, bootstrapFailed, refreshBootstrap })
  const wake = useRef<(confirm?: boolean) => void>(() => undefined)
  const confirm = useCallback(() => wake.current(true), [])
  useEffect(() => {
    latest.current = { liveAt, bootstrapFailed, refreshBootstrap }
    wake.current(bootstrapFailed)
  }, [liveAt, bootstrapFailed, refreshBootstrap])
  useOnForeground(() => wake.current(true))

  useEffect(() => {
    let stopped = false
    let busy = false
    let timer: ReturnType<typeof setTimeout>
    let httpFailed = false
    let next = 0
    let lastHttpObservation: number | undefined
    let confirmNeeded = false

    function publish(contact: Contact) {
      setObservation((old) => {
        if (old.contact === contact) {
          return old
        }
        const recovered = old.contact === 'disconnected' && contact !== 'checking'
        return { contact, recoveredAt: recovered ? Date.now() : old.recoveredAt }
      })
    }

    async function check(confirm = false) {
      clearTimeout(timer)
      if (stopped || document.visibilityState === 'hidden') {
        return
      }
      const quietUntil = latest.current.liveAt + HEALTHY_MS
      if (quietUntil > Date.now() && httpFailed) {
        publish('degraded')
      }
      if (quietUntil > Date.now() && !confirm && !httpFailed && !latest.current.bootstrapFailed) {
        publish('connected')
        timer = setTimeout(() => void check(), quietUntil - Date.now())
        return
      }
      const lastObservedAt = Math.max(latest.current.liveAt, lastHttpObservation ?? 0)
      if (confirm && !httpFailed && Date.now() - lastObservedAt > HEALTHY_MS) {
        publish('checking')
      }
      if (busy) {
        confirmNeeded ||= confirm
        return
      }
      if (next > Date.now() && (!confirm || httpFailed)) {
        timer = setTimeout(() => void check(), next - Date.now())
        return
      }
      busy = true
      try {
        await read()
        if (stopped) {
          return
        }
        lastHttpObservation = Date.now()
        httpFailed = false
        publish('connected')
        if (latest.current.bootstrapFailed) {
          latest.current.refreshBootstrap()
        }
      } catch {
        if (stopped) {
          return
        }
        httpFailed = true
        publish(latest.current.liveAt + HEALTHY_MS > Date.now() ? 'degraded' : 'disconnected')
      } finally {
        busy = false
        if (!stopped) {
          const delay =
            httpFailed || latest.current.bootstrapFailed ? 4000 + Math.random() * 500 : HEALTHY_MS
          next = Date.now() + delay
          clearTimeout(timer)
          if (confirmNeeded) {
            confirmNeeded = false
            timer = setTimeout(() => void check(true), 0)
          } else {
            timer = setTimeout(() => void check(), delay)
          }
        }
      }
    }

    wake.current = (confirm) => void check(confirm)
    wake.current()
    return () => {
      stopped = true
      clearTimeout(timer)
      wake.current = () => undefined
    }
  }, [read])
  return (
    <Context.Provider value={{ ...observation, bootstrapFailed, confirm }}>
      {children}
    </Context.Provider>
  )
}
