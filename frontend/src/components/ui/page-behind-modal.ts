// A native modal made the whole page behind it inert. Radix only sets aria-hidden, and leaves
// live regions and their ancestors exposed, such as masthead buttons that hold a live status.
// So every other top-level element is made inert and hidden while any modal is open.
//
// Holds are counted per element, because stacked modals can close in any order: the evidence
// viewer can unmount while the crop editor over it stays open. An element gets back its own
// attributes only when no open modal still holds it.

type Hold = { count: number; addedInert: boolean; addedHidden: boolean }

const holds = new Map<Element, Hold>()

function hold(element: Element) {
  let current = holds.get(element)
  if (!current) {
    current = {
      count: 0,
      addedInert: !element.hasAttribute('inert'),
      addedHidden: element.getAttribute('aria-hidden') !== 'true',
    }
    holds.set(element, current)
    if (current.addedInert) {
      element.setAttribute('inert', '')
    }
    if (current.addedHidden) {
      element.setAttribute('aria-hidden', 'true')
    }
  }
  current.count += 1
}

function release(element: Element) {
  const current = holds.get(element)
  if (!current) {
    return
  }
  current.count -= 1
  if (current.count > 0) {
    return
  }
  holds.delete(element)
  if (current.addedInert) {
    element.removeAttribute('inert')
  }
  if (current.addedHidden) {
    element.removeAttribute('aria-hidden')
  }
}

/** Makes the page behind a modal's backdrop and surface inert; returns the function that undoes it. */
export function hidePageBehind(surface: HTMLElement) {
  const backdrop = surface.previousElementSibling
  const held = Array.from(document.body.children).filter(
    (element) => element !== surface && element !== backdrop,
  )
  for (const element of held) {
    hold(element)
  }
  return () => {
    for (const element of held) {
      release(element)
    }
  }
}
