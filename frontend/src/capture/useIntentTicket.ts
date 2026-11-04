import { useCallback, useEffect, useRef } from 'react'

/**
 * Orders asynchronous choices behind later intent: every new choice or direct edit takes a
 * ticket, and only the newest ticket of a still-mounted field may apply its late result.
 */
export function useIntentTicket() {
  const ticket = useRef(0)
  const mounted = useRef(false)
  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
    }
  }, [])
  const take = useCallback(() => {
    ticket.current += 1
    return ticket.current
  }, [])
  const isCurrent = useCallback((value: number) => mounted.current && ticket.current === value, [])
  return { take, isCurrent }
}
