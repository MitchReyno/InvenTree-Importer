import { useEffect, useRef } from 'react'
import type { FieldValues, UseFormWatch } from 'react-hook-form'

/**
 * Counts edits to a React Hook Form draft, so a preview requested for an older draft is ignored.
 * It follows the form's own watch subscription, because field-array appends and removes change
 * the draft without a native change event.
 */
export function useDraftGeneration<T extends FieldValues>(
  watch: UseFormWatch<T>,
  onChange: () => void,
) {
  const generation = useRef(0)
  const latest = useRef(onChange)
  useEffect(() => {
    latest.current = onChange
  })
  useEffect(() => {
    const subscription = watch(() => {
      generation.current += 1
      latest.current()
    })
    return () => subscription.unsubscribe()
  }, [watch])
  return generation
}
