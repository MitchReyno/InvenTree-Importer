import { useRef, type KeyboardEvent } from 'react'

const NEXT_KEYS = new Set(['ArrowRight', 'ArrowDown'])
const PREVIOUS_KEYS = new Set(['ArrowLeft', 'ArrowUp'])

/**
 * One tab stop for a group of option buttons: the selected option (or the first) is tabbable,
 * and arrow, Home and End keys move focus within the group, wrapping at the ends.
 */
export function useRovingFocus(ids: string[], selected: string | undefined) {
  const buttons = useRef(new Map<string, HTMLButtonElement>())
  const tabStop = ids.includes(selected ?? '') ? selected : ids[0]

  function focusAt(index: number) {
    const wrapped = (index + ids.length) % ids.length
    buttons.current.get(ids[wrapped])?.focus()
  }

  function handleKeyDown(event: KeyboardEvent<HTMLButtonElement>, id: string) {
    const index = ids.indexOf(id)
    if (NEXT_KEYS.has(event.key)) {
      focusAt(index + 1)
    } else if (PREVIOUS_KEYS.has(event.key)) {
      focusAt(index - 1)
    } else if (event.key === 'Home') {
      focusAt(0)
    } else if (event.key === 'End') {
      focusAt(ids.length - 1)
    } else {
      return
    }
    event.preventDefault()
  }

  function optionProps(id: string) {
    return {
      ref: (element: HTMLButtonElement | null) => {
        if (element) {
          buttons.current.set(id, element)
        } else {
          buttons.current.delete(id)
        }
      },
      tabIndex: id === tabStop ? 0 : -1,
      onKeyDown: (event: KeyboardEvent<HTMLButtonElement>) => handleKeyDown(event, id),
    }
  }

  return optionProps
}
