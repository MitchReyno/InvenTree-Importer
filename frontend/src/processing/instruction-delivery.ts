import { useState } from 'react'

/** Whether the batch's saved instructions reached its agent sessions. */
export type InstructionDelivery =
  | { status: 'idle' }
  | { status: 'sending' }
  | { status: 'failed' }
  | { status: 'sent'; sessions: number; woken: number }

/**
 * Sends saved instructions and keeps the outcome. It lives above Processing, which remounts on
 * the reload a save causes, so a failed send still shows its retry afterwards.
 */
export function useInstructionDelivery(
  batchId: string,
  send: ((batchId: string) => Promise<{ sessions: number; woken: number }>) | undefined,
) {
  const [state, setState] = useState<{ batchId: string; delivery: InstructionDelivery }>({
    batchId,
    delivery: { status: 'idle' },
  })
  const delivery: InstructionDelivery =
    state.batchId === batchId ? state.delivery : { status: 'idle' }

  const deliver = send
    ? async () => {
        setState({ batchId, delivery: { status: 'sending' } })
        try {
          const sent = await send(batchId)
          setState({ batchId, delivery: { status: 'sent', ...sent } })
        } catch {
          setState({ batchId, delivery: { status: 'failed' } })
        }
      }
    : undefined

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
