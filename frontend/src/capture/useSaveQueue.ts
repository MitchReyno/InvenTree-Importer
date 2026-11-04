import { useCallback, useEffect, useState, useSyncExternalStore } from 'react'
import { SaveQueue } from './save-queue'

/** Mounts one queue for the lifetime of the editor; it survives own acknowledgements. */
export function useSaveQueue(revision: string) {
  const [queue] = useState(() => new SaveQueue({ revision }))
  const subscribe = useCallback((listener: () => void) => queue.subscribe(listener), [queue])
  const state = useSyncExternalStore(subscribe, () => queue.state())
  useEffect(() => () => queue.dispose(), [queue])
  return [queue, state] as const
}
