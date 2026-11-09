import { createContext, useContext, type ReactNode } from 'react'
import type { HeaderClient } from '#/header/types'
import { useHeaderObservations } from '#/header/useHeaderObservations'

type HeaderObservations = ReturnType<typeof useHeaderObservations>

const HeaderObservationsContext = createContext<HeaderObservations | null>(null)

type ProviderProps = {
  /** Null before the app has a scoped header client; children then read nothing shared. */
  client: HeaderClient | null
  batchId?: string
  children: ReactNode
}

/**
 * Reads the header's connection and work once, with one clock and one foreground listener, for
 * every `HeaderStatus` beneath it: the masthead's and the condensed phone row's copy.
 */
export function HeaderObservationsProvider({ client, batchId, children }: ProviderProps) {
  if (!client) {
    return children
  }

  return (
    <Reads client={client} batchId={batchId}>
      {children}
    </Reads>
  )
}

function Reads({
  client,
  batchId,
  children,
}: {
  client: HeaderClient
  batchId?: string
  children: ReactNode
}) {
  const observations = useHeaderObservations(client, batchId)

  return (
    <HeaderObservationsContext.Provider value={observations}>
      {children}
    </HeaderObservationsContext.Provider>
  )
}

/** The shared observations, or null outside a provider. */
export function useSharedHeaderObservations() {
  return useContext(HeaderObservationsContext)
}
