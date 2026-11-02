import { useRef, useState } from 'react'
import { classifyFailure, failureMessage, type CommandFailure } from './command-failure'

interface Intent<I> {
  input: I
  key: string
}

export interface RetainedCommand<I, R> {
  busy: boolean
  failure: CommandFailure | null
  message: string
  /** True while an uncertain intent must be retried exactly or explicitly discarded. */
  pending: boolean
  submit: (input: I) => Promise<R | null>
  retry: () => Promise<R | null>
  discard: () => void
}

/**
 * Binds one payload to one idempotency key until the server confirms or definitely refuses it.
 * An uncertain outcome keeps the exact payload and key for retry; it never mints a second key.
 */
export function useRetainedCommand<I, R>(
  send: (input: I, key: string) => Promise<R>,
): RetainedCommand<I, R> {
  const intent = useRef<Intent<I> | null>(null)
  const [busy, setBusy] = useState(false)
  const [failure, setFailure] = useState<CommandFailure | null>(null)

  async function run(current: Intent<I>) {
    setBusy(true)
    setFailure(null)
    try {
      const result = await send(current.input, current.key)
      intent.current = null
      return result
    } catch (error) {
      const classified = classifyFailure(error)
      if (classified.kind !== 'uncertain') {
        intent.current = null
      }
      setFailure(classified)
      return null
    } finally {
      setBusy(false)
    }
  }

  return {
    busy,
    failure,
    message: failure ? failureMessage(failure) : '',
    pending: intent.current !== null,

    submit(input) {
      if (intent.current) {
        return run(intent.current)
      }
      intent.current = { input, key: crypto.randomUUID() }
      return run(intent.current)
    },

    retry() {
      return intent.current ? run(intent.current) : Promise.resolve(null)
    },

    discard() {
      intent.current = null
      setFailure(null)
    },
  }
}
