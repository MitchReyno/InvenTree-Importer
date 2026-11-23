// A native modal made the whole page behind it inert. Radix only sets aria-hidden, and leaves
// live regions and their ancestors exposed, such as masthead buttons that hold a live status.
// So every other top-level element is made inert and hidden while the modal is open; only the
// attributes added here are removed again, so a modal beneath keeps its own.

/** Makes the page behind a modal's backdrop and surface inert; returns the function that undoes it. */
export function hidePageBehind(surface: HTMLElement) {
  const backdrop = surface.previousElementSibling
  const restores: Array<() => void> = []
  for (const element of Array.from(document.body.children)) {
    if (element === surface || element === backdrop || !(element instanceof HTMLElement)) {
      continue
    }
    if (!element.hasAttribute('inert')) {
      element.setAttribute('inert', '')
      restores.push(() => element.removeAttribute('inert'))
    }
    if (element.getAttribute('aria-hidden') !== 'true') {
      element.setAttribute('aria-hidden', 'true')
      restores.push(() => element.removeAttribute('aria-hidden'))
    }
  }
  return () => {
    for (const restore of restores) {
      restore()
    }
  }
}
