import { act, renderHook } from '@testing-library/react'
import { expect, test, vi } from 'vitest'
import { useDraft } from './draft'

function renderDraft(saved: string) {
  const report = vi.fn()
  const view = renderHook(({ value }) => useDraft(value, report), {
    initialProps: { value: saved },
  })
  return { ...view, report }
}

test('a clean draft follows a new saved value without ever reporting dirty', () => {
  const { result, rerender, report } = renderDraft('Resistor')
  rerender({ value: 'Carbon resistor' })
  expect(result.current[0]).toBe('Carbon resistor')
  expect(result.current[2]).toBe(false)
  expect(report).not.toHaveBeenCalledWith(true)
})

test('a dirty draft keeps its value and stays dirty when the saved value changes', () => {
  const { result, rerender, report } = renderDraft('Resistor')
  act(() => result.current[1]('Metal film'))
  expect(report).toHaveBeenLastCalledWith(true)
  rerender({ value: 'Carbon resistor' })
  expect(result.current[0]).toBe('Metal film')
  expect(result.current[2]).toBe(true)
  expect(report).toHaveBeenLastCalledWith(true)
})

test('a save that catches up with the draft makes it clean', () => {
  const { result, rerender, report } = renderDraft('Resistor')
  act(() => result.current[1]('Metal film'))
  rerender({ value: 'Metal film' })
  expect(result.current[2]).toBe(false)
  expect(report).toHaveBeenLastCalledWith(false)
  rerender({ value: 'Later' })
  expect(result.current[0]).toBe('Later')
  expect(result.current[2]).toBe(false)
})

test('typing back to the saved value, or reset, releases the guard', () => {
  const { result, report } = renderDraft('Resistor')
  act(() => result.current[1]('Metal film'))
  act(() => result.current[1]('Resistor'))
  expect(result.current[2]).toBe(false)
  expect(report).toHaveBeenLastCalledWith(false)
  act(() => result.current[1]('Metal film'))
  act(() => result.current[3]())
  expect(result.current[0]).toBe('Resistor')
  expect(report).toHaveBeenLastCalledWith(false)
})

test('closing the editor with a draft releases the guard', () => {
  const { result, unmount, report } = renderDraft('Resistor')
  act(() => result.current[1]('Metal film'))
  unmount()
  expect(report).toHaveBeenLastCalledWith(false)
})
