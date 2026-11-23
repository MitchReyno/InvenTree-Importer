import { useRef, useState, type DragEvent } from 'react'

export type FileDropHandlers = {
  onDragEnter: (event: DragEvent<HTMLElement>) => void
  onDragOver: (event: DragEvent<HTMLElement>) => void
  onDragLeave: (event: DragEvent<HTMLElement>) => void
  onDrop: (event: DragEvent<HTMLElement>) => void
}

/** Files dragged in from outside the page; dragging a tile within it carries none. */
function carriesFiles(event: DragEvent<HTMLElement>) {
  return Array.from(event.dataTransfer?.types ?? []).includes('Files')
}

/**
 * Makes an element a target for files dragged from outside the page. The innermost target takes
 * the files and stops them reaching the targets around it. A refused drop is still taken, so the
 * browser doesn't open the file instead, and `onFiles` says why; `accepting` only sets the
 * highlight.
 */
export function useFileDrop(onFiles: (files: File[]) => void, accepting: boolean) {
  // Entering a child fires before leaving its parent, so the highlight counts entries.
  const entered = useRef(0)
  const [over, setOver] = useState(false)

  function handleDragEnter(event: DragEvent<HTMLElement>) {
    if (!carriesFiles(event)) {
      return
    }
    event.preventDefault()
    event.stopPropagation()
    entered.current += 1
    setOver(true)
  }

  function handleDragOver(event: DragEvent<HTMLElement>) {
    if (!carriesFiles(event)) {
      return
    }
    // Cancelling dragover is what lets the drop land here.
    event.preventDefault()
    event.stopPropagation()
    event.dataTransfer.dropEffect = 'copy'
  }

  function handleDragLeave(event: DragEvent<HTMLElement>) {
    if (!carriesFiles(event)) {
      return
    }
    event.stopPropagation()
    entered.current = Math.max(0, entered.current - 1)
    if (entered.current === 0) {
      setOver(false)
    }
  }

  function handleDrop(event: DragEvent<HTMLElement>) {
    if (!carriesFiles(event)) {
      return
    }
    event.preventDefault()
    event.stopPropagation()
    entered.current = 0
    setOver(false)
    onFiles(Array.from(event.dataTransfer.files))
  }

  const handlers: FileDropHandlers = {
    onDragEnter: handleDragEnter,
    onDragOver: handleDragOver,
    onDragLeave: handleDragLeave,
    onDrop: handleDrop,
  }
  return { over: over && accepting, handlers }
}
