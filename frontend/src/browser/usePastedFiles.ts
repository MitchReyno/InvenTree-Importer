import { useEffect, useEffectEvent } from 'react'

// A paste into a field is the field's own; a paste inside a modal dialog isn't meant for the
// page behind it.
const KEEPS_ITS_PASTE =
  'input, textarea, select, [contenteditable]:not([contenteditable="false"]), dialog, [role="dialog"]'

function keepsItsPaste(target: EventTarget | null) {
  return target instanceof Element && target.closest(KEEPS_ITS_PASTE) !== null
}

/**
 * Receives files pasted anywhere on the page while mounted, such as a screenshot. Pastes into text
 * fields and dialogs, and pastes without files, are left to the browser.
 */
export function usePastedFiles(onFiles: (files: File[]) => void) {
  const pasted = useEffectEvent(onFiles)

  useEffect(() => {
    // The document hears a paste wherever focus is, including on the page body.
    function handlePaste(event: ClipboardEvent) {
      if (keepsItsPaste(event.target)) {
        return
      }
      const files = Array.from(event.clipboardData?.files ?? [])
      if (!files.length) {
        return
      }
      event.preventDefault()
      pasted(files)
    }

    document.addEventListener('paste', handlePaste)
    return () => document.removeEventListener('paste', handlePaste)
  }, [])
}
