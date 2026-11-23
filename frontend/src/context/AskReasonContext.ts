import { createContext, useContext } from 'react'

/**
 * Why asking an agent waits, such as a Processing read still landing: an ask names its session from
 * that read and carries no revision. Absent when asking is available.
 */
export const AskReasonContext = createContext<string | undefined>(undefined)

export function useAskReason() {
  return useContext(AskReasonContext)
}
