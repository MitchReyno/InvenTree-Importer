import { useEffect, useRef, useState } from 'react'

/** The parts of a drag event a drop target reads; React's and the DOM's both provide them. */
export type FileDragEvent = {
  target: EventTarget | null
  currentTarget: HTMLElement
  dataTransfer: DataTransfer | null
  preventDefault: () => void
  stopPropagation: () => void
}

export type FileDropHandlers = {
  onDragEnter: (event: FileDragEvent) => void
  onDragOver: (event: FileDragEvent) => void
  onDragLeave: (event: FileDragEvent) => void
  onDrop: (event: FileDragEvent) => void
}

// Every element that has taken files, so the document can tell which target is nearest.
const dropTargets = new WeakSet<Node>()

function nearestDropTarget(node: Node | null) {
  let current = node
  while (current && !dropTargets.has(current)) {
    current = current.parentNode
  }
  return current
}

/**
 * Where files dragged in from outside the page are, as seen by this element: over it (`here`, with
 * the node under them), over a portal it renders elsewhere in the document, such as a modal viewer
 * whose events React still bubbles here, or neither. Dragging a tile within the page carries no
 * files.
 */
type FileDragPlace = { kind: 'here'; node: Node } | { kind: 'portal' } | { kind: 'none' }

function fileDragPlace(event: FileDragEvent): FileDragPlace {
  const target = event.target
  if (!Array.from(event.dataTransfer?.types ?? []).includes('Files')) {
    return { kind: 'none' }
  }
  if (!(target instanceof Node) || !event.currentTarget.contains(target)) {
    return { kind: 'portal' }
  }
  return { kind: 'here', node: target }
}

/**
 * Makes an element a target for files dragged from outside the page. The innermost target takes
 * the files and stops them reaching the targets around it. A refused drop is still taken, so the
 * browser doesn't open the file instead, and `onFiles` says why; `accepts` only sets the
 * highlight, read as the files arrive. Files over a portal, such as a modal dialog, can't be
 * dropped there at all.
 */
export function useFileDrop(onFiles: (files: File[]) => void, accepts: () => boolean) {
  // The elements the files are over. Entering a child fires before leaving its parent, and a
  // child removed while hovered never reports leaving, so removed ones are dropped on each event.
  const entered = useRef(new Set<Node>())
  const owner = useRef<HTMLElement | null>(null)
  const [over, setOver] = useState(false)

  // A hovered child removed under the files never reports leaving, so while highlighted the
  // document is watched for the files moving to another target or outside this one, and for a
  // drop anywhere.
  useEffect(() => {
    if (!over) {
      return
    }

    function forget() {
      entered.current.clear()
      setOver(false)
    }

    function handleDocumentDragOver(event: globalThis.DragEvent) {
      const target = event.target
      if (!(target instanceof Node) || nearestDropTarget(target) !== owner.current) {
        forget()
      }
    }

    document.addEventListener('dragover', handleDocumentDragOver, true)
    document.addEventListener('drop', forget, true)
    return () => {
      document.removeEventListener('dragover', handleDocumentDragOver, true)
      document.removeEventListener('drop', forget, true)
    }
  }, [over])

  function keepConnected(target: HTMLElement) {
    for (const node of entered.current) {
      if (!target.contains(node)) {
        entered.current.delete(node)
      }
    }
  }

  function handleDragEnter(event: FileDragEvent) {
    const place = fileDragPlace(event)
    if (place.kind !== 'here') {
      return
    }
    event.preventDefault()
    event.stopPropagation()
    owner.current = event.currentTarget
    dropTargets.add(event.currentTarget)
    entered.current.add(place.node)
    keepConnected(event.currentTarget)
    setOver(accepts())
  }

  function handleDragOver(event: FileDragEvent) {
    const place = fileDragPlace(event)
    if (place.kind === 'none') {
      return
    }
    // Cancelling dragover is what lets the drop land, or with `none` refuses it outright.
    event.preventDefault()
    event.stopPropagation()
    if (event.dataTransfer) {
      event.dataTransfer.dropEffect = place.kind === 'here' ? 'copy' : 'none'
    }
    // The gate can open or close while the files hover; the highlight follows it.
    if (place.kind === 'here' && entered.current.size > 0) {
      setOver(accepts())
    }
  }

  function handleDragLeave(event: FileDragEvent) {
    const place = fileDragPlace(event)
    if (place.kind !== 'here') {
      return
    }
    event.stopPropagation()
    entered.current.delete(place.node)
    keepConnected(event.currentTarget)
    if (entered.current.size === 0) {
      setOver(false)
    }
  }

  function handleDrop(event: FileDragEvent) {
    const place = fileDragPlace(event)
    if (place.kind === 'none') {
      return
    }
    event.preventDefault()
    event.stopPropagation()
    entered.current.clear()
    setOver(false)
    if (place.kind === 'here') {
      onFiles(Array.from(event.dataTransfer?.files ?? []))
    }
  }

  const handlers: FileDropHandlers = {
    onDragEnter: handleDragEnter,
    onDragOver: handleDragOver,
    onDragLeave: handleDragLeave,
    onDrop: handleDrop,
  }
  return { over, handlers }
}
