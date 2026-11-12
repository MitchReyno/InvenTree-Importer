import { useCallback, useRef } from 'react'
import { useMountedRef } from '#/lifecycle/useMountedRef'

/**
 * Orders asynchronous choices behind later intent: every new choice or direct edit takes a
 * ticket, and only the newest ticket of a still-mounted field may apply its late result.
 */
export function useIntentTicket() {
  const ticket = useRef(0)
  const mounted = useMountedRef()
  const take = useCallback(() => {
    ticket.current += 1
    return ticket.current
  }, [])
  const isCurrent = useCallback(
    (value: number) => mounted.current && ticket.current === value,
    [mounted],
  )
  return { take, isCurrent }
}
