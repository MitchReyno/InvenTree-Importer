import type { ReactNode } from 'react'
import { BatchCommandsContext, type BatchCommands } from '#/capture/batch-commands'

export function BatchCommandsProvider({
  value,
  children,
}: {
  value: BatchCommands
  children: ReactNode
}) {
  return <BatchCommandsContext.Provider value={value}>{children}</BatchCommandsContext.Provider>
}
