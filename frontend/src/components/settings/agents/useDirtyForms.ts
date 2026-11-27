import { useEffect, useMemo, useRef } from 'react'

/**
 * Several forms share one navigation guard: it stays held while any of them has unsaved input,
 * so one form's save never releases another form's edit. `beforeLeave` saves what can be saved
 * when the operator leaves, and answers whether nothing is left unsaved.
 */
export function useDirtyForms(
  onDirtyChange: (dirty: boolean, beforeLeave?: () => Promise<boolean>) => void,
  beforeLeave: () => Promise<boolean>,
) {
  const dirty = useRef(new Set<string>())
  const report = useRef(onDirtyChange)
  const leave = useRef(beforeLeave)
  useEffect(() => {
    report.current = onDirtyChange
    leave.current = beforeLeave
  }, [onDirtyChange, beforeLeave])
  // Leaving drops every draft, so the guard is released with them.
  useEffect(
    () => () => {
      dirty.current.clear()
      report.current(false)
    },
    [],
  )
  return useMemo(() => {
    const flush = () => leave.current()

    return {
      report(form: string, isDirty: boolean) {
        if (isDirty) {
          dirty.current.add(form)
        } else {
          dirty.current.delete(form)
        }
        const any = dirty.current.size > 0
        report.current(any, any ? flush : undefined)
      },
      anyDirty: () => dirty.current.size > 0,
    }
  }, [])
}
