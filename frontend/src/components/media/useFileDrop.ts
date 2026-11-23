import { useRef, useState, type DragEvent } from 'react'

export type FileDropHandlers = {
  onDragEnter: (event: DragEvent<HTMLElement>) => void
  onDragOver: (event: DragEvent<HTMLElement>) => void
  onDragLeave: (event: DragEvent<HTMLElement>) => void
  onDrop: (event: DragEvent<HTMLElement>) => void
}

/**
 * The node under files dragged in from outside the page, when it lies inside this element, or
 * null. Dragging a tile within the page carries no files, and React also bubbles events from a
 * portal, such as a modal viewer, that sits elsewhere in the document.
 */
function fileDragTarget(event: DragEvent<HTMLElement>): Node | null {
  const target = event.target
  if (!(target instanceof Node) || !event.currentTarget.contains(target)) {
    return null
  }
  return Array.from(event.dataTransfer?.types ?? []).includes('Files') ? target : null
}

/**
 * Makes an element a target for files dragged from outside the page. The innermost target takes
 * the files and stops them reaching the targets around it. A refused drop is still taken, so the
 * browser doesn't open the file instead, and `onFiles` says why; `accepting` only sets the
 * highlight.
 */
export function useFileDrop(onFiles: (files: File[]) => void, accepting: boolean) {
  // The elements the files are over. Entering a child fires before leaving its parent, and a
  // child removed while hovered never reports leaving, so removed ones are dropped on each event.
  const entered = useRef(new Set<Node>())
  const [over, setOver] = useState(false)

  function keepConnected(target: HTMLElement) {
    for (const node of entered.current) {
      if (!target.contains(node)) {
        entered.current.delete(node)
      }
    }
  }

  function handleDragEnter(event: DragEvent<HTMLElement>) {
    const target = fileDragTarget(event)
    if (!target) {
      return
    }
    event.preventDefault()
    event.stopPropagation()
    entered.current.add(target)
    keepConnected(event.currentTarget)
    setOver(true)
  }

  function handleDragOver(event: DragEvent<HTMLElement>) {
    if (!fileDragTarget(event)) {
      return
    }
    // Cancelling dragover is what lets the drop land here.
    event.preventDefault()
    event.stopPropagation()
    event.dataTransfer.dropEffect = 'copy'
  }

  function handleDragLeave(event: DragEvent<HTMLElement>) {
    const target = fileDragTarget(event)
    if (!target) {
      return
    }
    event.stopPropagation()
    entered.current.delete(target)
    keepConnected(event.currentTarget)
    setOver(entered.current.size > 0)
  }

  function handleDrop(event: DragEvent<HTMLElement>) {
    if (!fileDragTarget(event)) {
      return
    }
    event.preventDefault()
    event.stopPropagation()
    entered.current.clear()
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
