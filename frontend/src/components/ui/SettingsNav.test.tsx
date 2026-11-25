import { render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { SettingsNav } from './SettingsNav'

const sections = [
  { id: 'agents', label: 'Agents', href: '#settings/agents', agent: true },
  { id: 'inventree', label: 'InvenTree', href: '#settings/inventree' },
  { id: 'appearance', label: 'Appearance', href: '#settings/appearance' },
]

test('links back to where Settings was opened, then lists the sections', () => {
  render(
    <SettingsNav
      back={{ label: 'Mouser 3381-22 › Processing', href: '#b1/processing/overview' }}
      sections={sections}
      current="inventree"
    />,
  )
  const nav = screen.getByRole('navigation', { name: 'Settings' })
  const links = within(nav).getAllByRole('link')

  expect(links[0]).toHaveAccessibleName('Back to Mouser 3381-22 › Processing')
  expect(links[0]).toHaveAttribute('href', '#b1/processing/overview')
  expect(within(nav).getByRole('heading', { name: 'Settings', level: 2 })).toBeInTheDocument()
  expect(links.slice(1).map((link) => link.textContent)).toEqual([
    'Agents',
    'InvenTree',
    'Appearance',
  ])
  expect(within(nav).getByRole('link', { name: 'InvenTree' })).toHaveAttribute(
    'aria-current',
    'page',
  )
  expect(within(nav).getByRole('link', { name: 'Agents' })).not.toHaveAttribute('aria-current')
  expect(
    within(nav).getByRole('link', { name: 'Agents' }).querySelector('[data-ai-mark]'),
  ).not.toBeNull()
})

test("lists an open section's subsections under it and marks the one the route points at", () => {
  const withSubsections = [
    {
      ...sections[0],
      subsections: [
        { id: 'providers', label: 'Providers', href: '#settings/agents/providers' },
        { id: 'models', label: 'Provider and model per step', href: '#settings/agents/models' },
      ],
    },
    ...sections.slice(1),
  ]
  const { rerender } = render(
    <SettingsNav
      back={{ label: 'Batches', href: '#' }}
      sections={withSubsections}
      current="agents"
      currentSubsection="models"
    />,
  )
  const group = screen.getByLabelText('Agents sections')
  expect(within(group).getByRole('link', { name: 'Provider and model per step' })).toHaveAttribute(
    'aria-current',
    'location',
  )
  expect(within(group).getByRole('link', { name: 'Providers' })).not.toHaveAttribute('aria-current')

  rerender(
    <SettingsNav
      back={{ label: 'Batches', href: '#' }}
      sections={withSubsections}
      current="inventree"
    />,
  )
  expect(screen.queryByLabelText('Agents sections')).toBeNull()
})

const agentsOpen = [
  {
    ...sections[0],
    subsections: [
      { id: 'providers', label: 'Providers', href: '#settings/agents/providers' },
      { id: 'sessions', label: 'Sessions', href: '#settings/agents/sessions' },
    ],
  },
  ...sections.slice(1),
]

function renderAgentsOpen() {
  render(
    <SettingsNav
      back={{ label: 'Batches', href: '#' }}
      sections={agentsOpen}
      current="agents"
      currentSubsection="providers"
    />,
  )
  const nav = screen.getByRole('navigation', { name: 'Settings' })

  return {
    nav,
    link: (name: string) => within(nav).getByRole('link', { name }),
    group: within(nav).getByRole('group', { name: 'Agents sections' }),
  }
}

// jsdom computes an unset or transparent background as this.
const NO_BACKGROUND = 'rgba(0, 0, 0, 0)'

/** The span that holds a link's or heading's words. */
function words(element: Element) {
  const span = element.firstElementChild
  if (!(span instanceof HTMLSpanElement)) {
    throw new Error('expected the words in a span')
  }
  return span
}

/** The declarations of the injected rules that match `element`, as written. */
function declared(element: Element) {
  const rules = [...document.styleSheets].flatMap((sheet) => [...sheet.cssRules])

  return rules
    .filter(
      (rule): rule is CSSStyleRule =>
        rule instanceof CSSStyleRule && element.matches(rule.selectorText),
    )
    .map((rule) => rule.style.cssText)
    .join(' ')
}

/** Injected rules for `:hover` whose selector matches `element` once the pointer is over it. */
function hoverRules(element: Element) {
  const rules = [...document.styleSheets].flatMap((sheet) => [...sheet.cssRules])

  return rules.filter(
    (rule): rule is CSSStyleRule =>
      rule instanceof CSSStyleRule &&
      rule.selectorText.includes(':hover') &&
      element.matches(rule.selectorText.replaceAll(':hover', '')),
  )
}

describe('behind the whole window', () => {
  beforeEach(() => {
    document.documentElement.dataset.masthead = 'window'
  })

  afterEach(() => {
    delete document.documentElement.dataset.masthead
  })

  test('the nav has no background and idle links back only their words', () => {
    const { nav, link } = renderAgentsOpen()

    expect(getComputedStyle(nav).backgroundColor).not.toContain('masthead-ground')
    for (const name of ['Back to Batches', 'InvenTree', 'Sessions']) {
      const idle = link(name)
      expect(getComputedStyle(idle).backgroundColor).not.toContain('masthead-ground')
      const backing = getComputedStyle(words(idle))
      expect(backing.backgroundColor).toContain('masthead-ground')
      expect([backing.paddingTop, backing.paddingRight]).toEqual(['1px', '5px'])
      expect([backing.marginTop, backing.marginRight]).toEqual(['-1px', '-5px'])
      expect(backing.borderRadius).toContain('radius-sm')
    }
    const heading = within(nav).getByRole('heading', { name: 'Settings' })
    expect(getComputedStyle(words(heading)).backgroundColor).toContain('masthead-ground')
  })

  test('hover and the current section and subsection keep their full fill', () => {
    const { link } = renderAgentsOpen()

    for (const name of ['Agents', 'Providers']) {
      expect(getComputedStyle(words(link(name))).backgroundColor).toBe(NO_BACKGROUND)
    }
    expect(declared(link('Agents'))).toContain('background: var(--accent-weak)')
    expect(declared(link('Providers'))).toContain('background: var(--surface-2)')
    for (const name of ['Back to Batches', 'InvenTree', 'Sessions']) {
      const declarations = hoverRules(words(link(name))).map((rule) => rule.style.backgroundColor)
      expect(declarations).toContain('transparent')
      const fills = hoverRules(link(name)).map((rule) => rule.style.cssText)
      expect(fills.join(' ')).toContain('background: var(--surface-2)')
    }
  })

  test('the subsection rule is a drawn line, so it shows between backed words', () => {
    const { group } = renderAgentsOpen()
    const list = declared(group)

    expect(list).toContain('border-left-color: transparent')
    expect(list).toContain('linear-gradient(var(--line), var(--line)) 0 0/1px 100% no-repeat')
  })
})

test('in the bar the nav and its words have no backing, as before', () => {
  document.documentElement.dataset.masthead = 'bar'
  try {
    const { nav, link, group } = renderAgentsOpen()

    expect(getComputedStyle(nav).backgroundColor).toBe(NO_BACKGROUND)
    for (const name of ['Back to Batches', 'InvenTree', 'Sessions']) {
      expect(getComputedStyle(words(link(name))).backgroundColor).toBe(NO_BACKGROUND)
    }
    expect(declared(group)).toContain('border-left: 1px solid var(--line)')
    expect(declared(group)).not.toContain('linear-gradient')
  } finally {
    delete document.documentElement.dataset.masthead
  }
})
