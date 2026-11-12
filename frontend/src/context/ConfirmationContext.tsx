import { createContext, useCallback, useContext, useState, type ReactNode } from 'react'
import { Toast } from '#/components/ui'

const ConfirmationContext = createContext<(message: string) => void>(() => {})

/**
 * Owns the confirmation toast above revision-keyed screens, so the reload a confirmed command
 * causes does not unmount its confirmation.
 */
export function ConfirmationProvider({ children }: { children: ReactNode }) {
  const [shown, setShown] = useState<{ id: number; message: string } | null>(null)
  const confirm = useCallback(
    (message: string) => setShown((previous) => ({ id: (previous?.id ?? 0) + 1, message })),
    [],
  )
  return (
    <ConfirmationContext.Provider value={confirm}>
      {children}
      {shown && <Toast key={shown.id} message={shown.message} onDismiss={() => setShown(null)} />}
    </ConfirmationContext.Provider>
  )
}

/** Raises a confirmation; outside a provider it does nothing. */
export function useConfirmation() {
  return useContext(ConfirmationContext)
}
