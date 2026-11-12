import { createContext, useContext } from 'react'

/** Loads the current batch without touching record drafts, so a refused save can be retried. */
export const ReloadContext = createContext<(() => Promise<boolean>) | undefined>(undefined)

/** One record save at a time: the batch sends one edit, so every Save waits for it. */
export const SavingContext = createContext<{
  saving: boolean
  setSaving: (value: boolean) => void
}>({
  saving: false,
  setSaving: () => {},
})

export function useRecordReload() {
  return useContext(ReloadContext)
}

export function useRecordSaving() {
  return useContext(SavingContext)
}
