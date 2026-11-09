import { createContext, useContext } from 'react'
import type { CaptureEdit, CaptureObserve } from './types'

/** The open batch's capture commands, owned by `Batch`. */
export interface BatchCommands {
  edit: CaptureEdit
  observe: CaptureObserve
  /** Reloads the saved batch for the open stage. */
  reload: () => Promise<void>
}

export const BatchCommandsContext = createContext<BatchCommands | null>(null)

/** The open batch's commands; only components rendered inside a batch may call it. */
export function useBatchCommands() {
  const commands = useContext(BatchCommandsContext)
  if (!commands) {
    throw new Error('useBatchCommands needs a BatchCommandsProvider')
  }

  return commands
}
