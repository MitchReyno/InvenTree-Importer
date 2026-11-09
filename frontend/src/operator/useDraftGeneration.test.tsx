import { act, renderHook } from '@testing-library/react'
import { useFieldArray, useForm } from 'react-hook-form'
import { expect, test, vi } from 'vitest'
import { useDraftGeneration } from './useDraftGeneration'

test('every edit, including a field-array append, advances the generation and reports it', () => {
  const onChange = vi.fn()
  const { result } = renderHook(() => {
    const form = useForm({ defaultValues: { label: '', rows: [{ name: 'a' }] } })
    const rows = useFieldArray({ control: form.control, name: 'rows' })
    const generation = useDraftGeneration(form.watch, onChange)
    return { form, rows, generation }
  })
  expect(result.current.generation.current).toBe(0)
  act(() => result.current.form.setValue('label', 'Reels'))
  expect(result.current.generation.current).toBe(1)
  act(() => result.current.rows.append({ name: 'b' }))
  expect(result.current.generation.current).toBe(2)
  expect(onChange).toHaveBeenCalledTimes(2)
})
