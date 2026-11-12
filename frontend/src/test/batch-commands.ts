import type { BatchCommands } from '#/context'

/** Batch commands for rendering a batch surface alone; unspecified commands do nothing. */
export function batchCommands(commands: Partial<BatchCommands> = {}): BatchCommands {
  return {
    edit: async () => false,
    observe: async () => null,
    reload: async () => undefined,
    ...commands,
  }
}
