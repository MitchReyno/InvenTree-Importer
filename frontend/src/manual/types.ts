import type { manualClient } from '@invimport/contracts/client'
export type ManualClient = ReturnType<typeof manualClient>
export type ManualStage = 'capture' | 'review' | 'approve' | 'results'
