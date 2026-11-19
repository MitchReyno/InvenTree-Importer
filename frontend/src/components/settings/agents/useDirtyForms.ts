import { useCallback, useRef } from 'react'

/**
 * Several forms share one navigation guard: it stays held while any of them has unsaved input,
 * so one form's save never releases another form's edit.
 */
export function useDirtyForms(onDirtyChange: (dirty: boolean) => void) {
  const dirty = useRef(new Set<string>())
  return useCallback(
    (form: string, isDirty: boolean) => {
      if (isDirty) {
        dirty.current.add(form)
      } else {
        dirty.current.delete(form)
      }
      onDirtyChange(dirty.current.size > 0)
    },
    [onDirtyChange],
  )
}
