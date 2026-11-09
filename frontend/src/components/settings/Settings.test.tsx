import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useQueryClient } from '@tanstack/react-query'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { useState, type ReactNode } from 'react'
import type { ConnectionStatusDto } from '@invimport/contracts'
import type { agentsClient } from '@invimport/contracts/client'
import { fixtureScope, render } from '#/test/render'
import { serverQueryKey } from '#/queries/scope'
import { HeaderObservationsProvider } from '#/components/masthead/HeaderObservations'
import { THEME_STORAGE_KEY, themeController } from '#/theme/theme'
import { Settings } from './Settings'
import type { SettingsSectionId } from '#/navigation/app-route'

const batchId = '10000000-0000-4000-8000-000000000001'
const identity = {
  actor_id: fixtureScope.actorId,
  target_id: fixtureScope.targetId,
  target_context_id: fixtureScope.targetContextId,
}

function agents() {
  return {
    settings: vi.fn(async () => ({
      revision: '7',
      selection: { provider: 'claude', authentication: 'subscription', model: 'sonnet' },
      session_concurrency: 3,
    })),
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
  }: { returnTo?: string; client?: ReturnType<typeof agentsClient> } = {},
) {
  return render(
    <HeaderObservationsProvider client={header}>
      <CachedBatch title="Mouser 3381-22">
        <Settings section={section} returnTo={returnTo} agents={client} onDirtyChange={vi.fn()} />
      </CachedBatch>
    </HeaderObservationsProvider>,
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
  const items = within(nav)
    .getAllByRole('link')
    .slice(1)
    .map((link) => [link.textContent, link.getAttribute('href')])

  expect(items).toEqual([
    ['Agents', '#settings/agents'],
    ['InvenTree', '#settings/inventree'],
    ['Batch defaults', '#settings/defaults'],
    ['Descriptions and naming', '#settings/descriptions'],
    ['Appearance', '#settings/appearance'],
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

const DEFERRED: [SettingsSectionId, string[]][] = [
  ['agents', ['Model per step', 'Instructions for every new batch', 'Web research']],
  ['inventree', ['API token', 'Import reference prefix']],
  ['defaults', ['Default location', 'Default supplier', 'Tags']],
  [
    'descriptions',
    ['Fill descriptions for', 'Part description style', 'Supplier part descriptions'],
  ],
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

test('without an agents client the Agents section says so and the other sections still work', () => {
  render(<Settings section="agents" returnTo={undefined} agents={null} onDirtyChange={vi.fn()} />)

  expect(screen.getByText(/Agent settings are unavailable/)).toBeVisible()
  expect(screen.getByRole('link', { name: 'Appearance' })).toHaveAttribute(
    'href',
    '#settings/appearance',
  )
})
