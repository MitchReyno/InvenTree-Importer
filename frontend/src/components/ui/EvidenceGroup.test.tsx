import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { expect, test, vi } from 'vitest'
import { EvidenceGroup } from './EvidenceGroup'

function renderGroup(name = 'Reels') {
  const onRename = vi.fn()
  const onDraftChange = vi.fn()
  const props = { count: 2, onRename, onDraftChange }
  const view = render(<EvidenceGroup {...props} name={name} />)
  return { ...view, props, onRename, onDraftChange, field: screen.getByLabelText('Group name') }
}

test('renaming reports a draft, and Escape puts the saved name back', async () => {
  const user = userEvent.setup()
  const { field, onDraftChange } = renderGroup()
  await user.type(field, ' 2')
  expect(onDraftChange).toHaveBeenLastCalledWith(true)
  await user.keyboard('{Escape}')
  expect(field).toHaveValue('Reels')
  expect(onDraftChange).toHaveBeenLastCalledWith(false)
})

test('Enter sends the trimmed name once, and the saved name arriving clears the draft', async () => {
  const user = userEvent.setup()
  const { field, onRename, onDraftChange, props, rerender } = renderGroup()
  await user.clear(field)
  await user.type(field, '  Big reels  {Enter}')
  field.blur()
  expect(onRename).toHaveBeenCalledOnce()
  expect(onRename).toHaveBeenCalledWith('Big reels')
  rerender(<EvidenceGroup {...props} name="Big reels" />)
  expect(field).toHaveValue('Big reels')
  expect(onDraftChange).toHaveBeenLastCalledWith(false)
})

test('a saved name that changes while the draft is clean is shown', () => {
  const { field, props, rerender } = renderGroup()
  rerender(<EvidenceGroup {...props} name="Renamed elsewhere" />)
  expect(field).toHaveValue('Renamed elsewhere')
})

test('a saved name that changes mid-rename keeps the operator’s draft', async () => {
  const user = userEvent.setup()
  const { field, props, rerender, onDraftChange } = renderGroup()
  await user.type(field, ' 2')
  rerender(<EvidenceGroup {...props} name="Renamed elsewhere" />)
  expect(field).toHaveValue('Reels 2')
  expect(onDraftChange).toHaveBeenLastCalledWith(true)
})

test('removing the group mid-rename releases the guard', async () => {
  const user = userEvent.setup()
  const { field, onDraftChange, unmount } = renderGroup()
  await user.type(field, ' 2')
  unmount()
  expect(onDraftChange).toHaveBeenLastCalledWith(false)
})

/** Focus rules whose selector, without its focus pseudo-class, matches `element` as it is now. */
function focusRulesFor(element: Element, pseudo: ':focus' | ':focus-visible') {
  const rules = [...document.styleSheets].flatMap((sheet) => [...sheet.cssRules])

  return rules.filter((rule): rule is CSSStyleRule => {
    if (!(rule instanceof CSSStyleRule)) {
      return false
    }

    return rule.selectorText
      .split(',')
      .map((selector) => selector.trim())
      .filter((selector) => selector.endsWith(pseudo))
      .some((selector) => element.matches(selector.slice(0, -pseudo.length)))
  })
}

function hasRing(rules: CSSStyleRule[]) {
  return rules.some((rule) => rule.style.outline.includes('var(--ring-width)'))
}

test('a group region rings on keyboard focus, and on plain focus only when marked for it', () => {
  render(<EvidenceGroup name="Reels" count={2} label="Reels" tabIndex={-1} />)
  const region = screen.getByRole('region', { name: 'Reels' })

  expect(hasRing(focusRulesFor(region, ':focus-visible'))).toBe(true)
  expect(hasRing(focusRulesFor(region, ':focus'))).toBe(false)
  region.setAttribute('data-focus-ring', '')
  expect(hasRing(focusRulesFor(region, ':focus'))).toBe(true)
})
