import { useEffect, useRef, useState } from 'react'

/** Whether the batch's saved instructions reached its agent sessions. */
export type InstructionDelivery =
  | { status: 'idle' }
  | { status: 'pending' }
  | { status: 'sending' }
  | { status: 'failed' }
  | { status: 'sent'; sessions: number; woken: number }

/** Waits for a settled read that started after the request and the last live hint. */
export type DeliveryGate = (signal: AbortSignal) => Promise<void>

/**
 * Sends saved instructions and keeps the outcome. It lives above Processing, which remounts on
 * the reload a save causes, so a held or failed send still shows afterwards. Delivery sends no
 * revision, so each send, automatic or Retry, waits in "Delivery pending" for the gate and then
 * sends once.
 */
export function useInstructionDelivery(
  batchId: string,
  send: ((batchId: string) => Promise<{ sessions: number; woken: number }>) | undefined,
  gate?: DeliveryGate,
) {
  const [state, setState] = useState<{ batchId: string; delivery: InstructionDelivery }>({
    batchId,
    delivery: { status: 'idle' },
  })
  // The wait in progress, if any; a Retry replaces it, and a send in flight is never repeated.
  const waiting = useRef<{ controller: AbortController; sending: boolean } | null>(null)
  const delivery: InstructionDelivery =
    state.batchId === batchId ? state.delivery : { status: 'idle' }

  // The wait outlives Processing's remounts but not the batch.
  useEffect(() => {
    return () => waiting.current?.controller.abort()
  }, [batchId])

  async function deliverNow(sendInstructions: NonNullable<typeof send>) {
    if (waiting.current?.sending) {
      return
    }
    waiting.current?.controller.abort()
    const current = { controller: new AbortController(), sending: false }
    waiting.current = current
    setState({ batchId, delivery: { status: 'pending' } })
    try {
      await gate?.(current.controller.signal)
    } catch {
      // Replaced by a Retry, or the batch closed: that newer wait owns the outcome.
      return
    }
    current.sending = true
    setState({ batchId, delivery: { status: 'sending' } })
    try {
      const sent = await sendInstructions(batchId)
      setState({ batchId, delivery: { status: 'sent', ...sent } })
    } catch {
      setState({ batchId, delivery: { status: 'failed' } })
    } finally {
      if (waiting.current === current) {
        waiting.current = null
      }
    }
  }

  const deliver = send ? () => deliverNow(send) : undefined

  return { delivery, deliver }
}

export function deliveryMessage(delivery: InstructionDelivery) {
  if (delivery.status !== 'sent') {
    return null
  }
  const { sessions, woken } = delivery
  if (sessions === 0) {
    return 'No session is working on the batch yet; new ones start with it.'
  }
  return `Sent to ${sessions} ${sessions === 1 ? 'session' : 'sessions'}${
    woken ? `; ${woken} finished ${woken === 1 ? 'one is' : 'ones are'} woken to apply it.` : '.'
  }`
}
