import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useQueryClient } from '@tanstack/react-query'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { useState, type ReactNode } from 'react'
import type { ConnectionStatusDto } from '@invimport/contracts'
import type { agentsClient } from '@invimport/contracts/client'
import { fixtureScope, render } from '#/test/render'
import { agentSettings } from '#/test/agent-settings'
import { serverQueryKey } from '#/queries/scope'
import { HeaderObservationsProvider } from '#/context'
import { MASTHEAD_STORAGE_KEY, mastheadStyleController } from '#/theme/masthead-style'
import { THEME_STORAGE_KEY, themeController } from '#/theme/theme'
import { Settings } from './Settings'
import {
  settingsSection,
  settingsSubsection,
  type AgentSubsectionId,
  type SettingsSectionId,
} from '#/navigation/app-route'

const batchId = '10000000-0000-4000-8000-000000000001'
const identity = {
  actor_id: fixtureScope.actorId,
  target_id: fixtureScope.targetId,
  target_context_id: fixtureScope.targetContextId,
}

function agents() {
  return {
    settings: vi.fn(async () =>
      agentSettings('7', { provider: 'claude', authentication: 'subscription', model: 'sonnet' }),
    ),
    saveSettings: vi.fn(),
    sessions: vi.fn(async () => ({
      sessions: [],
      next_before: null,
      sessions_supported: true,
      paused_batch_ids: [],
    })),
    failure: vi.fn(),
    pause: vi.fn(),
    pauseAll: vi.fn(),
    deliverInstructions: vi.fn(),
  } as unknown as ReturnType<typeof agentsClient>
}

function connection(): ConnectionStatusDto {
  return {
    ...identity,
    target: {
      kind: 'owned_test',
      state: 'reachable',
      freshness: 'fresh',
      observed_at: new Date().toISOString(),
      failure_code: null,
      navigation_url: 'https://inventory.example.test/',
      label: 'Bench target',
      version: '1.1.0',
    },
  } as ConnectionStatusDto
}

const header = {
  connection: vi.fn(async () => connection()),
  checkConnection: vi.fn(async () => connection()),
  work: vi.fn(async () => ({
    ...identity,
    observed_at: new Date().toISOString(),
    work: [],
    active_sessions: [],
    work_truncated: false,
    sessions_truncated: false,
    lane_occupied: false,
  })),
}

/** Seeds the batch read the batch screen held before Settings opened. */
function CachedBatch({ title, children }: { title: string; children: ReactNode }) {
  const queryClient = useQueryClient()
  useState(() =>
    queryClient.setQueryData(serverQueryKey(fixtureScope, 'capture', batchId), {
      title,
      revision: '1',
    }),
  )

  return children
}

function renderSettings(
  section: SettingsSectionId,
  {
    returnTo,
    client = agents(),
    subsection,
  }: {
    returnTo?: string
    client?: ReturnType<typeof agentsClient>
    subsection?: AgentSubsectionId
  } = {},
) {
  return render(settingsElement(section, subsection, { returnTo, client }))
}

/** The Settings page as the app mounts it; `rerender` with another route keeps it mounted. */
function settingsElement(
  section: SettingsSectionId,
  subsection: AgentSubsectionId | undefined,
  {
    returnTo,
    client = agents(),
  }: { returnTo?: string; client?: ReturnType<typeof agentsClient> } = {},
) {
  return (
    <HeaderObservationsProvider client={header}>
      <CachedBatch title="Mouser 3381-22">
        <Settings
          section={section}
          subsection={subsection}
          returnTo={returnTo}
          agents={client}
          onDirtyChange={vi.fn()}
        />
      </CachedBatch>
    </HeaderObservationsProvider>
  )
}

let send: ReturnType<typeof vi.fn>

beforeEach(() => {
  send = vi.fn(async () => new Response(null, { status: 500 }))
  vi.stubGlobal('fetch', send)
})

afterEach(() => {
  vi.unstubAllGlobals()
})

test('the section nav lists every section, marks the current one and the Agents item carries the AI mark', async () => {
  renderSettings('agents')
  const nav = screen.getByRole('navigation', { name: 'Settings' })
  const subsections = within(nav).getByLabelText('Agents sections')
  const items = within(nav)
    .getAllByRole('link')
    .slice(1)
    .filter((link) => !subsections.contains(link))
    .map((link) => [link.textContent, link.getAttribute('href')])

  expect(items).toEqual([
    ['Agents', '#settings/agents'],
    ['InvenTree', '#settings/inventree'],
    ['Batch defaults', '#settings/defaults'],
    ['Appearance', '#settings/appearance'],
    ['Developer', '#settings/developer'],
  ])
  const current = within(nav).getByRole('link', { name: 'Agents' })
  expect(current).toHaveAttribute('aria-current', 'page')
  expect(current.querySelector('[data-ai-mark]')).not.toBeNull()
  const heading = await screen.findByRole('heading', { level: 2, name: 'Agents' })
  expect(heading.querySelector('[data-ai-mark]')).not.toBeNull()
})

test('the back link names the batch tab Settings was opened from and returns to it', () => {
  renderSettings('agents', { returnTo: `${batchId}/review/records` })

  expect(screen.getByRole('link', { name: 'Back to Mouser 3381-22 › Review' })).toHaveAttribute(
    'href',
    `#${batchId}/review/records`,
  )
})

test('a direct load goes back to Batches', () => {
  renderSettings('inventree')

  expect(screen.getByRole('link', { name: 'Back to Batches' })).toHaveAttribute('href', '#')
})

test('InvenTree shows the observed server, its last check and Open InvenTree without credentials', async () => {
  renderSettings('inventree')

  expect(await screen.findByText('Test InvenTree')).toBeVisible()
  expect(screen.getByRole('heading', { level: 2, name: 'InvenTree' })).toBeVisible()
  expect(screen.getByRole('link', { name: 'Open InvenTree' })).toHaveAttribute(
    'href',
    'https://inventory.example.test/',
  )
  expect(screen.getByText(/never to a real one/)).toBeVisible()
  expect(screen.queryByText(/token=/i)).toBeNull()
})

test('the API token row shows Refused after Check now, and the import reference is read-only', async () => {
  const user = userEvent.setup()
  const refused = connection()
  header.checkConnection.mockResolvedValueOnce({
    ...refused,
    target: { ...refused.target, state: 'unavailable', failure_code: 'unauthorized' },
  })
  renderSettings('inventree')
  const token = screen.getByRole('group', { name: 'API token' })
  expect(await within(token).findByText('Accepted')).toBeVisible()
  await user.click(within(token).getByRole('button', { name: 'Check now' }))
  expect(await within(token).findByText('Refused')).toBeVisible()
  expect(header.checkConnection).toHaveBeenCalledTimes(1)
  const reference = screen.getByRole('group', { name: 'Import reference' })
  expect(reference).toHaveTextContent('bi1:‹batch source›:‹lot›')
  expect(within(reference).queryByRole('textbox')).toBeNull()
})

test('the API token row never shows a stale or failed read as current', async () => {
  const old = connection()
  header.connection.mockResolvedValueOnce({
    ...old,
    target: {
      ...old.target,
      freshness: 'stale',
      observed_at: new Date(Date.now() - 120_000).toISOString(),
    },
  })
  const view = renderSettings('inventree')
  const token = screen.getByRole('group', { name: 'API token' })
  // Once the stale observation has loaded, its check time shows beside Unavailable.
  expect(await within(token).findByText(/checked/)).toBeVisible()
  expect(within(token).getByText('Unavailable')).toBeVisible()
  view.unmount()

  header.connection.mockRejectedValueOnce(new Error('offline'))
  renderSettings('inventree')
  await screen.findByText('InvenTree unreachable')
  expect(
    within(screen.getByRole('group', { name: 'API token' })).getByText('Unavailable'),
  ).toBeVisible()
})

const DEFERRED: [SettingsSectionId, string[]][] = [
  [
    'agents',
    [
      'Model per step',
      'Instructions for every new batch',
      'Fill descriptions for',
      'Part description style',
      'Supplier part descriptions',
      'Suggest tags automatically',
      'Web research',
    ],
  ],
  ['inventree', ['API token']],
  ['defaults', ['Default location', 'Default supplier', 'Tags']],
]

for (const [section, rows] of DEFERRED) {
  test(`deferred ${section} settings are focusable, explained, inoperable and send nothing`, async () => {
    const user = userEvent.setup()
    const client = agents()
    renderSettings(section, { client })
    if (section === 'agents') {
      await screen.findByRole('group', { name: 'Model per step' })
    }

    for (const name of rows) {
      const row = screen.getByRole('group', { name })
      const controls = [
        ...row.querySelectorAll<HTMLElement>(
          '[data-disabled-feature] :is(button, input, select, textarea)',
        ),
      ]

      expect(controls.length, name).toBeGreaterThan(0)
      for (const control of controls) {
        expect(control, name).toHaveAttribute('aria-disabled', 'true')
        expect(control, name).toHaveAccessibleDescription(/not available yet/i)
        const textField =
          control instanceof HTMLTextAreaElement ||
          (control instanceof HTMLInputElement && control.type === 'text')
        if (textField) {
          expect(control, name).toHaveAttribute('readonly')
        }
      }
      const first = controls[0]
      first.focus()
      await user.keyboard('{Enter}x ')
      await user.click(first)
      if (first instanceof HTMLInputElement && first.type !== 'text') {
        expect(first.checked, name).toBe(first.defaultChecked)
      }
    }
    expect(send).not.toHaveBeenCalled()
    expect(client.saveSettings).not.toHaveBeenCalled()
  })
}

test('Appearance holds the stored theme and changing it applies at once', async () => {
  const user = userEvent.setup()
  localStorage.setItem(THEME_STORAGE_KEY, 'dark')
  themeController().choose('dark')
  try {
    renderSettings('appearance')
    const theme = screen.getByRole('radiogroup', { name: 'Theme' })

    expect(within(theme).getByRole('radio', { name: 'Dark' })).toBeChecked()
    await user.click(within(theme).getByRole('radio', { name: 'Light' }))
    expect(document.documentElement.dataset.theme).toBe('light')
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe('light')
  } finally {
    themeController().choose('system')
  }
})

test('Appearance offers the masthead styles, applies one at once and remembers it', async () => {
  const user = userEvent.setup()
  mastheadStyleController().choose('bar')
  try {
    const { unmount } = renderSettings('appearance')
    const masthead = screen.getByRole('radiogroup', { name: 'Masthead' })
    const options = within(masthead).getAllByRole('radio')

    expect(options).toHaveLength(3)
    ;['In the bar', 'Behind the whole window', 'Fading down'].forEach((name, index) =>
      expect(options[index]).toHaveAccessibleName(name),
    )
    expect(within(masthead).getByRole('radio', { name: 'In the bar' })).toBeChecked()
    expect(
      within(masthead).getByRole('radio', { name: 'Fading down' }),
    ).toHaveAccessibleDescription('A band at the top that fades out.')

    await user.click(within(masthead).getByRole('radio', { name: 'Fading down' }))
    expect(document.documentElement.dataset.masthead).toBe('fade')
    expect(localStorage.getItem(MASTHEAD_STORAGE_KEY)).toBe('fade')

    unmount()
    renderSettings('appearance')
    expect(
      within(screen.getByRole('radiogroup', { name: 'Masthead' })).getByRole('radio', {
        name: 'Fading down',
      }),
    ).toBeChecked()
  } finally {
    mastheadStyleController().choose('bar')
  }
})

test('the masthead and theme choices change independently', async () => {
  const user = userEvent.setup()
  themeController().choose('light')
  mastheadStyleController().choose('bar')
  try {
    renderSettings('appearance')
    const theme = screen.getByRole('radiogroup', { name: 'Theme' })
    const masthead = screen.getByRole('radiogroup', { name: 'Masthead' })

    await user.click(within(masthead).getByRole('radio', { name: 'Behind the whole window' }))
    expect(within(theme).getByRole('radio', { name: 'Light' })).toBeChecked()
    expect(document.documentElement.dataset.theme).toBe('light')

    await user.click(within(theme).getByRole('radio', { name: 'Dark' }))
    expect(within(masthead).getByRole('radio', { name: 'Behind the whole window' })).toBeChecked()
    expect(document.documentElement.dataset.masthead).toBe('window')
    expect(document.documentElement.dataset.theme).toBe('dark')
  } finally {
    themeController().choose('system')
    mastheadStyleController().choose('bar')
  }
})

test('without an agents client the Agents section says so and the other sections still work', () => {
  render(<Settings section="agents" returnTo={undefined} agents={null} onDirtyChange={vi.fn()} />)

  expect(screen.getByText(/Agent settings are unavailable/)).toBeVisible()
  expect(screen.getByRole('link', { name: 'Appearance' })).toHaveAttribute(
    'href',
    '#settings/appearance',
  )
})

test('Agents lists its subsections under its nav link, each linking to its own route', () => {
  renderSettings('agents')
  const group = screen.getByLabelText('Agents sections')

  expect(
    within(group)
      .getAllByRole('link')
      .map((link) => [link.textContent, link.getAttribute('href')]),
  ).toEqual([
    ['Providers', '#settings/agents/providers'],
    ['Sessions', '#settings/agents/sessions'],
    ['Provider and model per step', '#settings/agents/models'],
    ['Instructions', '#settings/agents/instructions'],
    ['Descriptions and naming', '#settings/agents/descriptions'],
    ['Tag suggestions', '#settings/agents/tags'],
    ['Web research', '#settings/agents/research'],
  ])
  // Headings show before the saved settings load, so a link always has somewhere to land.
  expect(screen.getByRole('heading', { level: 3, name: 'Web research' })).toBeInTheDocument()
})

test('a subsection link focuses its heading and marks the link current', () => {
  renderSettings('agents', { subsection: 'descriptions' })

  const heading = screen.getByRole('heading', { level: 3, name: 'Descriptions and naming' })
  expect(heading).toHaveFocus()
  expect(
    within(screen.getByLabelText('Agents sections')).getByRole('link', {
      name: 'Descriptions and naming',
    }),
  ).toHaveAttribute('aria-current', 'location')
})

test('the old Descriptions and naming link opens that Agents subsection', () => {
  const route = 'settings/descriptions'
  renderSettings(settingsSection(route), { subsection: settingsSubsection(route) })

  expect(screen.getByRole('heading', { level: 2, name: 'Agents' })).toBeInTheDocument()
  expect(screen.getByRole('heading', { level: 3, name: 'Descriptions and naming' })).toHaveFocus()
  const fill = screen.getByRole('group', { name: 'Fill descriptions for' })
  // Agents already write Part descriptions, so only that switch shows on.
  expect(within(fill).getByRole('switch', { name: 'Parts · up to 250' })).toBeChecked()
  expect(within(fill).getByRole('switch', { name: 'Companies · up to 500' })).not.toBeChecked()
})

test('going back to Agents and then to the same subsection focuses its heading again', () => {
  const client = agents()
  const view = renderSettings('agents', { subsection: 'descriptions', client })
  const heading = screen.getByRole('heading', { level: 3, name: 'Descriptions and naming' })
  expect(heading).toHaveFocus()
  heading.blur()

  view.rerender(settingsElement('agents', undefined, { client }))
  view.rerender(settingsElement('agents', 'descriptions', { client }))

  expect(heading).toHaveFocus()
})

test('tag suggestions moved to Agents, leaving batch-name tags in Batch defaults', () => {
  const agentsView = renderSettings('agents')
  expect(screen.getByRole('group', { name: 'Suggest tags automatically' })).toBeInTheDocument()
  agentsView.unmount()

  renderSettings('defaults')
  expect(screen.queryByText('Suggest tags automatically')).toBeNull()
  expect(
    screen.getByRole('switch', { name: 'Tag every Part with its batch name' }),
  ).toBeInTheDocument()
})
