import { act, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import type { agentsClient } from '@invimport/contracts/client'
import { render } from '#/test/render'
import { agentSettings } from '#/test/agent-settings'
import { sessionList } from '#/test/agent-sessions'
import { stubPhoneViewport } from '#/test/viewport'
import { settingsSection, settingsSubsection } from '#/navigation/app-route'
import { useNavigationGuard } from '#/navigation/useNavigationGuard'
import { Settings } from '../Settings'
import { PAGE_HEIGHT, WINDOW_HEIGHT, stubSubsectionLayout } from '#/test/subsection-layout'

// Agents reads whether sessions have web access; these tests don't depend on it.
vi.mock('#/debug/useReadiness', () => ({ useReadiness: () => ({ data: { web: 'available' } }) }))

function agents() {
  return {
    settings: vi.fn(async () =>
      agentSettings('7', { provider: 'claude', authentication: 'subscription', model: 'sonnet' }),
    ),
    saveSettings: vi.fn(),
    sessions: vi.fn(async () => sessionList({ paused_batch_ids: [] })),
    failure: vi.fn(),
    pause: vi.fn(),
    pauseAll: vi.fn(),
    deliverInstructions: vi.fn(),
  } as unknown as ReturnType<typeof agentsClient>
}

let client: ReturnType<typeof agentsClient>

/** Settings as the app mounts it, with the app's navigation guard. */
function GuardedSettings() {
  const { route, settingsReturn, onDirtyChange, replaceSubsection, routeFromScroll } =
    useNavigationGuard()

  return (
    <Settings
      section={settingsSection(route)}
      subsection={settingsSubsection(route)}
      returnTo={settingsReturn}
      agents={client}
      onDirtyChange={onDirtyChange}
      replaceSubsection={replaceSubsection}
      routeFromScroll={routeFromScroll}
    />
  )
}

let layout: ReturnType<typeof stubSubsectionLayout>

function currentLink() {
  const group = screen.getByLabelText('Agents sections')

  return within(group)
    .getAllByRole('link')
    .find((link) => link.getAttribute('aria-current') === 'location')?.textContent
}

async function openAt(route: string) {
  history.replaceState({ settingsReturnTo: 'agents' }, '', `#${route}`)
  render(<GuardedSettings />)
  await screen.findByRole('group', { name: /^Claude$/ })
  // The scroll that opening at a subsection starts has ended.
  layout.endScroll()
}

beforeEach(() => {
  client = agents()
  layout = stubSubsectionLayout()
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response(null, { status: 500 })),
  )
})

afterEach(() => {
  layout.restore()
})

test('scrolling marks the subsection whose heading passed the reading line, replacing the address', async () => {
  await openAt('settings/agents/providers')
  const focused = document.activeElement
  const entries = history.length
  layout.scrollIntoView.mockClear()

  layout.scrollPage(1200)

  expect(currentLink()).toBe('Provider and model per step')
  expect(location.hash).toBe('#settings/agents/models')
  expect(history.length).toBe(entries)
  expect(history.state).toEqual({ settingsReturnTo: 'agents' })
  expect(document.activeElement).toBe(focused)
  // The route written by scrolling neither scrolls nor focuses its heading.
  expect(layout.scrollIntoView).not.toHaveBeenCalled()

  layout.scrollPage(700)

  expect(currentLink()).toBe('Sessions')
  expect(location.hash).toBe('#settings/agents/sessions')
  expect(document.activeElement).toBe(focused)
})

test('before any heading passes the line the first subsection is current, and at the end the last', async () => {
  await openAt('settings/agents/models')

  layout.scrollPage(50)
  expect(currentLink()).toBe('Providers')

  // Web research never reaches the line; the end of the page marks it.
  layout.scrollPage(PAGE_HEIGHT - WINDOW_HEIGHT)
  expect(currentLink()).toBe('Web research')
  expect(location.hash).toBe('#settings/agents/research')
})

test('a clicked link is current at once and its scroll marks nothing in between', async () => {
  const user = userEvent.setup()
  await openAt('settings/agents/providers')

  await user.click(screen.getByRole('link', { name: 'Tag suggestions' }))
  expect(currentLink()).toBe('Tag suggestions')
  expect(layout.scrollIntoView).toHaveBeenCalled()

  layout.scrollPage(1200)
  layout.scrollPage(2400)
  expect(currentLink()).toBe('Tag suggestions')
  expect(location.hash).toBe('#settings/agents/tags')

  // Once that scroll ends, scrolling by hand moves the mark again.
  layout.endScroll()
  layout.scrollPage(1200)
  expect(currentLink()).toBe('Provider and model per step')
})

test('without scrollend, a pause in scrolling ends the clicked link’s scroll', async () => {
  const user = userEvent.setup()
  await openAt('settings/agents/providers')

  await user.click(screen.getByRole('link', { name: 'Instructions' }))
  layout.scrollPage(1200)
  expect(currentLink()).toBe('Instructions')

  await act(async () => new Promise((done) => setTimeout(done, 200)))
  layout.scrollPage(700)
  expect(currentLink()).toBe('Sessions')
})

test('a link or a shared address still scrolls to and focuses its heading', async () => {
  const user = userEvent.setup()
  await openAt('settings/agents/descriptions')
  const descriptions = screen.getByRole('heading', { level: 3, name: 'Descriptions and naming' })
  expect(descriptions).toHaveFocus()
  expect(layout.scrollIntoView).toHaveBeenCalled()

  layout.scrollPage(1200)
  layout.scrollIntoView.mockClear()
  await user.click(screen.getByRole('link', { name: 'Web research' }))

  expect(layout.scrollIntoView).toHaveBeenCalled()
  expect(screen.getByRole('heading', { level: 3, name: 'Web research' })).toHaveFocus()
})

test('while the nav is stacked above the content, scrolling leaves the route’s subsection current', async () => {
  const restore = stubPhoneViewport()
  try {
    await openAt('settings/agents/sessions')

    layout.scrollPage(2400)

    expect(currentLink()).toBe('Sessions')
    expect(location.hash).toBe('#settings/agents/sessions')
  } finally {
    restore()
  }
})
