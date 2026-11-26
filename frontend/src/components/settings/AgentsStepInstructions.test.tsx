import { act, fireEvent, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { expect, test, vi } from 'vitest'
import type {
  AgentModelCatalogDto,
  AgentSettingsDto,
  AgentSettingsUpdateDto,
  ProviderStatusDto,
} from '@invimport/contracts'
import type { agentsClient } from '@invimport/contracts/client'
import { fixtureScope, render } from '#/test/render'
import { createServerQueryClient } from '#/queries/client'
import { serverQueryKey } from '#/queries/scope'
import { agentSettings, agentSettingsUpdate } from '#/test/agent-settings'
import { modelCatalog } from '#/test/model-catalog'
import { Settings } from './Settings'

vi.mock('#/debug/useReadiness', () => ({ useReadiness: () => ({ data: { web: 'available' } }) }))

const SELECTION = {
  provider: 'claude',
  authentication: 'subscription',
  model: 'claude-opus-5-5',
} as const
const RESEARCH = 'Open the manufacturer’s own datasheet before any distributor page.'
const IMAGES = 'Keep the anti-static bag in the stock photo.'
const READ_AT = new Date(2026, 10, 26, 9, 12).toISOString()

function settings(overrides: Partial<Omit<AgentSettingsDto, 'revision'>> = {}) {
  return agentSettings('7', SELECTION, overrides)
}

function client(saved = settings()) {
  return {
    settings: vi.fn(async () => saved),
    saveSettings: vi.fn(
      async ({ expected_revision: _, save_id: _id, ...fields }: AgentSettingsUpdateDto) => ({
        ...fields,
        revision: '8',
      }),
    ),
    sessions: vi.fn(async () => ({
      batches: [],
      sessions: [],
      next_before: null,
      totals: { slots_in_use: 0, queued: 0, waiting: 0 },
      paused_batch_ids: [],
      paused_truncated: false,
    })),
    pauseAll: vi.fn(),
    providerStatus: vi.fn(async (): Promise<ProviderStatusDto> => ({
      claude: { state: 'saved', saved_at: null, checked_at: READ_AT, last_sign_in_failure: null },
      codex: {
        state: 'signed_in',
        checked_at: READ_AT,
        refreshing: false,
        last_sign_in_failure: null,
      },
      read_at: READ_AT,
    })),
    modelCatalog: vi.fn(async (): Promise<AgentModelCatalogDto> => modelCatalog()),
    refreshModelCatalog: vi.fn(),
  }
}

type Api = ReturnType<typeof client>

function page(api: Api) {
  return (
    <Settings
      section="agents"
      returnTo={undefined}
      agents={api as unknown as ReturnType<typeof agentsClient>}
      onDirtyChange={vi.fn()}
      replaceSubsection={vi.fn()}
    />
  )
}

/** The Agents page over `api`, with its settings read again on request. */
async function renderAgents(api: Api) {
  const cache = createServerQueryClient()
  render(page(api), { cache })
  await screen.findByRole('group', { name: 'Research' })
  return {
    readSettingsAgain: () =>
      cache.refetchQueries({ queryKey: serverQueryKey(fixtureScope, 'agent-settings') }),
  }
}

const step = (name: string) => screen.getByRole('group', { name })

/** What a step's live regions say about a paste cut, across both of them. */
function cutMessage(name: string) {
  return within(step(name))
    .queryAllByRole('status')
    .map((region) => region.textContent)
    .filter((text) => text?.startsWith('1,000 characters'))
}

function count(name: string) {
  return within(step(name)).getByText(/ \/ 1,000$/)
}

async function openBox(user: ReturnType<typeof userEvent.setup>, name: string) {
  await user.click(within(step(name)).getByRole('button', { name: `Instructions for ${name}` }))
  return within(step(name)).getByRole('textbox', { name: `Instructions for ${name}` })
}

test('a step without instructions shows one quiet button, which opens an empty box with focus', async () => {
  const user = userEvent.setup()
  await renderAgents(client())
  for (const name of ['Examine', 'Research', 'Images']) {
    expect(within(step(name)).queryByRole('textbox')).toBeNull()
  }
  // Inventory takes no instructions.
  expect(within(step('Inventory')).queryByRole('button', { name: /^Instructions for/ })).toBeNull()
  const box = await openBox(user, 'Examine')
  expect(box).toHaveValue('')
  expect(box).toHaveFocus()
  expect(count('Examine')).toHaveTextContent('0 / 1,000')
  expect(within(step('Examine')).queryByRole('button', { name: 'Save' })).toBeNull()
})

test('Research’s instructions save on their own, and Save and Discard go until the next edit', async () => {
  const user = userEvent.setup()
  const api = client(settings({ stage_instructions: { images: IMAGES } }))
  await renderAgents(api)
  const box = await openBox(user, 'Research')
  await user.type(box, RESEARCH)
  expect(count('Research')).toHaveTextContent('66 / 1,000')
  await user.click(within(step('Research')).getByRole('button', { name: 'Save' }))
  await waitFor(() =>
    expect(api.saveSettings).toHaveBeenCalledWith(
      agentSettingsUpdate('7', SELECTION, {
        stage_instructions: { images: IMAGES, research: RESEARCH },
      }),
    ),
  )
  expect(await within(step('Research')).findByText(/^Saved\. New Research sessions/)).toBeVisible()
  expect(box).toHaveValue(RESEARCH)
  expect(
    within(step('Research')).getByText('Read by new Research sessions, after the app’s own rules.'),
  ).toBeVisible()
  expect(within(step('Research')).queryByRole('button', { name: 'Save' })).toBeNull()
  expect(within(step('Research')).queryByRole('button', { name: 'Discard my edit' })).toBeNull()
  // Images shows its saved text, and no Save until it is edited.
  const images = within(step('Images')).getByRole('textbox', { name: 'Instructions for Images' })
  expect(images).toHaveValue(IMAGES)
  expect(within(step('Images')).queryByRole('button', { name: 'Save' })).toBeNull()
  await user.type(box, ' Again.')
  expect(within(step('Research')).getByRole('button', { name: 'Save' })).toBeVisible()
  expect(within(step('Research')).getByRole('button', { name: 'Discard my edit' })).toBeVisible()
})

test('the count turns amber from 900, and typing stops at 1,000', async () => {
  const user = userEvent.setup()
  await renderAgents(client(settings({ stage_instructions: { research: 'x'.repeat(899) } })))
  const box = within(step('Research')).getByRole('textbox', { name: 'Instructions for Research' })
  expect(count('Research')).toHaveTextContent('899 / 1,000')
  expect(count('Research')).toHaveStyle({ color: 'var(--muted)' })
  await user.type(box, 'y')
  expect(count('Research')).toHaveTextContent('900 / 1,000')
  expect(count('Research')).toHaveStyle({ color: 'var(--warn)' })
  await user.type(box, 'z'.repeat(105))
  expect(box).toHaveValue(`${'x'.repeat(899)}y${'z'.repeat(100)}`)
  expect(count('Research')).toHaveTextContent('1,000 / 1,000')
  // Counted in characters, as the server counts them.
  fireEvent.change(box, { target: { value: '\u{1F50C}'.repeat(1000) } })
  expect(count('Research')).toHaveTextContent('1,000 / 1,000')
})

test('a paste past the limit is cut at 1,000 with an announced message', async () => {
  const user = userEvent.setup()
  const api = client(settings({ stage_instructions: { images: 'a'.repeat(950) } }))
  await renderAgents(api)
  const box = within(step('Images')).getByRole('textbox', { name: 'Instructions for Images' })
  await user.click(box)
  await user.paste('b'.repeat(200))
  expect(box).toHaveValue(`${'a'.repeat(950)}${'b'.repeat(50)}`)
  expect(count('Images')).toHaveTextContent('1,000 / 1,000')
  expect(count('Images')).toHaveStyle({ color: 'var(--warn)' })
  expect(cutMessage('Images')).toEqual([
    '1,000 characters is the most a step can hold. The pasted text was cut at 1,000.',
  ])
  await user.click(within(step('Images')).getByRole('button', { name: 'Save' }))
  await waitFor(() =>
    expect(api.saveSettings).toHaveBeenCalledWith(
      agentSettingsUpdate('7', SELECTION, {
        stage_instructions: { images: `${'a'.repeat(950)}${'b'.repeat(50)}` },
      }),
    ),
  )
})

test('a paste that fits goes in as it is, with no message', async () => {
  const user = userEvent.setup()
  await renderAgents(client())
  const box = await openBox(user, 'Research')
  await user.paste(RESEARCH)
  expect(box).toHaveValue(RESEARCH)
  expect(cutMessage('Research')).toEqual([])
})

test('Discard drops the edit; clearing and saving removes the instructions', async () => {
  const user = userEvent.setup()
  const api = client(settings({ stage_instructions: { research: RESEARCH } }))
  await renderAgents(api)
  const box = within(step('Research')).getByRole('textbox', { name: 'Instructions for Research' })
  await user.type(box, ' Mine.')
  await user.click(within(step('Research')).getByRole('button', { name: 'Discard my edit' }))
  expect(box).toHaveValue(RESEARCH)
  expect(api.saveSettings).not.toHaveBeenCalled()
  // An opened empty box that is discarded goes back to its button.
  await openBox(user, 'Examine')
  await user.type(within(step('Examine')).getByRole('textbox'), 'x')
  await user.click(within(step('Examine')).getByRole('button', { name: 'Discard my edit' }))
  expect(
    within(step('Examine')).getByRole('button', { name: 'Instructions for Examine' }),
  ).toBeVisible()

  await user.clear(box)
  await user.click(within(step('Research')).getByRole('button', { name: 'Save' }))
  await waitFor(() =>
    expect(api.saveSettings).toHaveBeenCalledWith(
      agentSettingsUpdate('7', SELECTION, { stage_instructions: {} }),
    ),
  )
  expect(
    await within(step('Research')).findByRole('button', { name: 'Instructions for Research' }),
  ).toBeVisible()
  expect(within(step('Research')).queryByRole('textbox')).toBeNull()
})

test('a paste counts each line break once, however the clipboard wrote it', async () => {
  const user = userEvent.setup()
  await renderAgents(client(settings({ stage_instructions: { research: 'a'.repeat(997) } })))
  const box = within(step('Research')).getByRole('textbox', { name: 'Instructions for Research' })
  await user.click(box)
  await user.paste('\r\nxy\r\nz')
  expect(box).toHaveValue(`${'a'.repeat(997)}\nxy`)
  expect(count('Research')).toHaveTextContent('1,000 / 1,000')
})

test('a paste while a save is in flight changes nothing', async () => {
  const user = userEvent.setup()
  const api = client()
  api.saveSettings.mockImplementationOnce(() => new Promise<never>(() => undefined))
  await renderAgents(api)
  const box = await openBox(user, 'Research')
  await user.type(box, RESEARCH)
  await user.click(within(step('Research')).getByRole('button', { name: 'Save' }))
  await waitFor(() => expect(box).toHaveAttribute('readonly'))
  fireEvent.paste(box, { clipboardData: { getData: () => 'x'.repeat(2000) } })
  expect(box).toHaveValue(RESEARCH)
  expect(cutMessage('Research')).toEqual([])
})

test('focus goes back to the step when its box closes, and into the box when it stays', async () => {
  const user = userEvent.setup()
  const api = client(settings({ stage_instructions: { research: RESEARCH } }))
  await renderAgents(api)
  await openBox(user, 'Examine')
  await user.type(within(step('Examine')).getByRole('textbox'), 'x')
  await user.click(within(step('Examine')).getByRole('button', { name: 'Discard my edit' }))
  expect(
    within(step('Examine')).getByRole('button', { name: 'Instructions for Examine' }),
  ).toHaveFocus()

  const box = within(step('Research')).getByRole('textbox', { name: 'Instructions for Research' })
  await user.type(box, ' Mine.')
  await user.click(within(step('Research')).getByRole('button', { name: 'Discard my edit' }))
  expect(box).toHaveFocus()

  await user.clear(box)
  await user.click(within(step('Research')).getByRole('button', { name: 'Save' }))
  await waitFor(() =>
    expect(
      within(step('Research')).getByRole('button', { name: 'Instructions for Research' }),
    ).toHaveFocus(),
  )
})

test('a second cut paste in a row is announced in the other live region', async () => {
  const user = userEvent.setup()
  await renderAgents(client(settings({ stage_instructions: { images: 'a'.repeat(999) } })))
  const box = within(step('Images')).getByRole('textbox', { name: 'Instructions for Images' })

  const regions = () =>
    within(step('Images'))
      .getAllByRole('status')
      .filter((region) => region.tagName === 'SMALL')
      .map((region) => region.textContent)

  await user.click(box)
  await user.paste('bb')
  const first = regions()
  await user.paste('cc')
  const second = regions()
  expect(first.filter(Boolean)).toHaveLength(1)
  expect(second.filter(Boolean)).toHaveLength(1)
  // The message moved to the region that was empty, so it is announced again.
  expect(second.findIndex(Boolean)).not.toBe(first.findIndex(Boolean))
  expect(box).toHaveValue(`${'a'.repeat(999)}b`)
})

test('after a save focus goes back into the box, unless the operator moved it', async () => {
  const user = userEvent.setup()
  const api = client()
  await renderAgents(api)
  const box = await openBox(user, 'Research')
  await user.type(box, RESEARCH)
  await user.click(within(step('Research')).getByRole('button', { name: 'Save' }))
  await within(step('Research')).findByText(/^Saved\. New Research sessions/)
  await waitFor(() => expect(box).toHaveFocus())

  // A clear whose save is answered after the operator tabbed away leaves their focus alone.
  let answer: (value: AgentSettingsDto) => void = () => undefined

  api.saveSettings.mockImplementationOnce(
    () => new Promise<AgentSettingsDto>((resolve) => (answer = resolve)),
  )
  await user.clear(box)
  await user.click(within(step('Research')).getByRole('button', { name: 'Save' }))
  const examine = within(step('Examine')).getByRole('button', { name: 'Instructions for Examine' })
  examine.focus()
  answer({ ...settings(), revision: '9' })
  const button = await within(step('Research')).findByRole('button', {
    name: 'Instructions for Research',
  })
  expect(examine).toHaveFocus()
  expect(button).not.toHaveFocus()
})

test('a finished save leaves nothing armed: a later read that changes the step takes no focus', async () => {
  const user = userEvent.setup()
  const api = client(settings({ stage_instructions: { research: RESEARCH } }))
  const rendered = await renderAgents(api)
  const box = within(step('Research')).getByRole('textbox', { name: 'Instructions for Research' })
  await user.clear(box)
  await user.click(within(step('Research')).getByRole('button', { name: 'Save' }))
  const button = await within(step('Research')).findByRole('button', {
    name: 'Instructions for Research',
  })
  await waitFor(() => expect(button).toHaveFocus())
  act(() => button.blur())
  // Saved again elsewhere: the read brings Research's box back.
  api.settings.mockResolvedValue({
    ...settings({ stage_instructions: { research: IMAGES } }),
    revision: '9',
  })
  await act(() => rendered.readSettingsAgain())
  expect(
    await within(step('Research')).findByRole('textbox', { name: 'Instructions for Research' }),
  ).toHaveValue(IMAGES)
  expect(document.body).toHaveFocus()
})

test('a resend confirmed after the operator clicked elsewhere leaves focus where it is', async () => {
  const user = userEvent.setup()
  const api = client()
  api.saveSettings.mockRejectedValueOnce(new Error('offline'))
  await renderAgents(api)
  const box = await openBox(user, 'Research')
  await user.type(box, RESEARCH)
  await user.click(within(step('Research')).getByRole('button', { name: 'Save' }))
  // A click on the page itself, which takes focus to no control.
  await user.click(document.body)
  await within(step('Research')).findByText(/^Saved\. New Research sessions/, undefined, {
    timeout: 4000,
  })
  expect(box).not.toHaveFocus()
  expect(document.body).toHaveFocus()
})

test('an operator who leaves during a resend and comes back to Save gets focus back', async () => {
  const user = userEvent.setup()
  const api = client()
  api.saveSettings.mockRejectedValueOnce(new Error('offline'))
  await renderAgents(api)
  const box = await openBox(user, 'Research')
  await user.type(box, RESEARCH)
  const save = within(step('Research')).getByRole('button', { name: 'Save' })
  await user.click(save)
  await user.click(document.body)
  await user.click(save)
  await within(step('Research')).findByText(/^Saved\. New Research sessions/, undefined, {
    timeout: 4000,
  })
  await waitFor(() => expect(box).toHaveFocus())
})

test('a save confirmed on its automatic resend still returns focus into the box', async () => {
  const user = userEvent.setup()
  const api = client()
  api.saveSettings.mockRejectedValueOnce(new Error('offline'))
  await renderAgents(api)
  const box = await openBox(user, 'Research')
  await user.type(box, RESEARCH)
  await user.click(within(step('Research')).getByRole('button', { name: 'Save' }))
  await within(step('Research')).findByText(/^Saved\. New Research sessions/, undefined, {
    timeout: 4000,
  })
  expect(api.saveSettings).toHaveBeenCalledTimes(2)
  await waitFor(() => expect(box).toHaveFocus())
})
