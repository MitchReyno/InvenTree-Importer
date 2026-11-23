// A native modal made the whole page behind it inert. Radix only sets aria-hidden, and leaves
// live regions and their ancestors exposed, such as masthead buttons that hold a live status.
// So while any modal is open, everything but the topmost modal is made inert and hidden.
//
// Open modals form one stack, as the browser's top layer did: the last opened is on top, even
// when two open in the same commit, and closing them in any order, such as the evidence viewer
// unmounting under the crop editor, leaves the page inert until the last one closes.

const stack: HTMLElement[] = []
let restorePage: (() => void) | null = null

// Every top-level element except the top modal's surface and backdrop; only attributes added
// here are removed again.
function isolate(top: HTMLElement) {
  const backdrop = top.previousElementSibling
  // A modal opened in the same commit may have hidden this one, as Radix hides every sibling.
  for (const element of [top, backdrop]) {
    element?.removeAttribute('inert')
    element?.removeAttribute('aria-hidden')
  }
  const restores: Array<() => void> = []
  for (const element of Array.from(document.body.children)) {
    if (element === top || element === backdrop) {
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

function isolateTop() {
  restorePage?.()
  restorePage = null
  const top = stack.at(-1)
  if (top) {
    restorePage = isolate(top)
  }
}

/** Puts a modal on top and makes the page behind it inert; returns the function that undoes it. */
export function hidePageBehind(surface: HTMLElement) {
  stack.push(surface)
  isolateTop()
  return () => {
    const index = stack.lastIndexOf(surface)
    if (index !== -1) {
      stack.splice(index, 1)
    }
    isolateTop()
  }
}
