import { useEffect, useEffectEvent, type RefObject } from 'react'
import type { FileDragEvent, FileDropHandlers } from './useFileDrop'

type DragType = 'dragenter' | 'dragover' | 'dragleave' | 'drop'

/**
 * Hands file drags in a slot that another component portals into, such as the batch notes, to
 * the drop target around the slot. React sends a portal's events up its owner's tree, so the
 * target's own handlers never hear them; the DOM's do.
 */
export function useSlotFileDrop(
  slot: HTMLElement | null,
  target: RefObject<HTMLElement | null>,
  handlers: FileDropHandlers,
) {
  const forward = useEffectEvent((type: DragType, event: DragEvent) => {
    const owner = target.current
    if (!owner) {
      return
    }
    const drag: FileDragEvent = {
      target: event.target,
      currentTarget: owner,
      dataTransfer: event.dataTransfer,
      preventDefault: () => event.preventDefault(),
      stopPropagation: () => event.stopPropagation(),
    }
    const handle = {
      dragenter: handlers.onDragEnter,
      dragover: handlers.onDragOver,
      dragleave: handlers.onDragLeave,
      drop: handlers.onDrop,
    }[type]
    handle(drag)
  })

  useEffect(() => {
    if (!slot) {
      return
    }
    const types: DragType[] = ['dragenter', 'dragover', 'dragleave', 'drop']
    const listeners = types.map((type) => {
      const listener = (event: DragEvent) => forward(type, event)

      slot.addEventListener(type, listener)
      return { type, listener }
    })
    return () => {
      for (const { type, listener } of listeners) {
        slot.removeEventListener(type, listener)
      }
    }
  }, [slot])
}
