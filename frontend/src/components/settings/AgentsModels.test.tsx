import { act, fireEvent, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import {
  BUILT_IN_MODEL_CATALOG,
  type AgentModelCatalogDto,
  type AgentModelCatalogRefreshReceiptDto,
  type AgentSettingsDto,
  type AgentSettingsUpdateDto,
  type ProviderStatusDto,
} from '@invimport/contracts'
import type { agentsClient } from '@invimport/contracts/client'
import { eventTimeText } from '#/components/ui'
import { resetRunnerQueue } from '#/components/agents/useChatGPTSignIn'
import { KEY_PAUSE_MS } from '#/components/agents/usePersonalClaudeCredential'
import { deferred } from '#/test/deferred'
import { render } from '#/test/render'
import { agentSettings } from '#/test/agent-settings'
import { builtinCatalog, CLAUDE_MODELS, modelCatalog, providerCatalog } from '#/test/model-catalog'
import { Settings } from './Settings'

vi.mock('#/debug/useReadiness', () => ({ useReadiness: () => ({ data: { web: 'available' } }) }))

const NOW = new Date(2026, 10, 26, 10, 0)
const TOKEN = 'sk-ant-oat01-abcdefghijklmnop'
const READ_0912 = new Date(2026, 10, 26, 9, 12).toISOString()

/** Both providers on; Research on Codex GPT-6.2-Sol, Images on Claude Opus 5.5 at Max. */
function settings(overrides: Partial<Omit<AgentSettingsDto, 'revision'>> = {}) {
  return agentSettings(
    '7',
    { provider: 'claude', authentication: 'subscription', model: 'claude-opus-5-5' },
    {
      providers: {
        claude: { enabled: true, authentication: 'subscription', default_model: 'claude-opus-5-5' },
        codex: { enabled: true, authentication: 'subscription', default_model: 'gpt-6.2-sol' },
      },
      stage_selections: {
        research: { provider: 'codex', model: 'gpt-6.2-sol' },
        images: { provider: 'claude', model: 'claude-opus-5-5', effort: 'max' },
      },
      ...overrides,
    },
  )
}

const receipt: AgentModelCatalogRefreshReceiptDto = {
  provider: 'claude',
  authentication: 'subscription',
  stale_sign_in: false,
}

function client(saved = settings(), catalog = modelCatalog()) {
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
      claude: { state: 'saved', saved_at: null, checked_at: READ_0912, last_sign_in_failure: null },
      codex: {
        state: 'signed_in',
        checked_at: READ_0912,
        refreshing: false,
        last_sign_in_failure: null,
      },
      read_at: READ_0912,
    })),
    modelCatalog: vi.fn(async (): Promise<AgentModelCatalogDto> => catalog),
    refreshModelCatalog: vi.fn(async () => receipt),
  }
}

type Api = ReturnType<typeof client>

async function renderAgents(api: Api) {
  render(
    <Settings
      section="agents"
      returnTo={undefined}
      agents={api as unknown as ReturnType<typeof agentsClient>}
      onDirtyChange={vi.fn()}
      replaceSubsection={vi.fn()}
    />,
  )
  await screen.findByRole('group', { name: 'Claude' })
  await waitFor(() => expect(api.modelCatalog).toHaveBeenCalled())
}

const autosaved = (assertion: () => void) => waitFor(assertion, { timeout: 3000 })

function pick(picker: HTMLElement, option: string, search: string) {
  fireEvent.change(picker, { target: { value: search } })
  fireEvent.click(screen.getByRole('option', { name: option }))
}

const optionTexts = (select: HTMLElement) =>
  within(select)
    .getAllByRole('option')
    .map((option) => option.textContent)

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(NOW)
  vi.stubGlobal('isSecureContext', true)
})

afterEach(() => {
  resetRunnerQueue()
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

test('Effort lists Default naming Codex’s own level, then the model’s levels, and saves at once', async () => {
  const api = client()
  await renderAgents(api)
  const effort = screen.getByRole('combobox', { name: 'Research effort' })
  expect(optionTexts(effort)).toEqual([
    'Default · Low',
    'Low',
    'Medium',
    'High',
    'Extra high',
    'Max',
    'Ultra',
  ])
  fireEvent.change(effort, { target: { value: 'high' } })
  await autosaved(() =>
    expect(api.saveSettings).toHaveBeenCalledWith(
      expect.objectContaining({
        stage_selections: {
          research: { provider: 'codex', model: 'gpt-6.2-sol', effort: 'high' },
          images: { provider: 'claude', model: 'claude-opus-5-5', effort: 'max' },
        },
      }),
    ),
  )
})

test('Claude’s Default reads plain Default, since Claude doesn’t name its level', async () => {
  await renderAgents(client())
  const effort = screen.getByRole('combobox', { name: 'Images effort' })
  expect(optionTexts(effort)[0]).toBe('Default')
  expect(effort).toHaveValue('max')
})

test('picking a model that lacks the level sets Default, says so, and saves both together', async () => {
  const api = client()
  await renderAgents(api)
  pick(screen.getByRole('combobox', { name: 'Images' }), 'Haiku 5.5 claude-haiku-5-5', 'haiku 5')
  expect(screen.getByRole('combobox', { name: 'Images effort' })).toHaveValue('')
  expect(screen.getByText('Effort set to Default: Haiku 5.5 has no Max.')).toBeVisible()
  await autosaved(() => expect(api.saveSettings).toHaveBeenCalledTimes(1))
  expect(api.saveSettings.mock.calls[0][0].stage_selections.images).toEqual({
    provider: 'claude',
    model: 'claude-haiku-5-5',
  })
})

test('a model with no levels disables Effort as No effort levels', async () => {
  await renderAgents(client())
  pick(screen.getByRole('combobox', { name: 'Research' }), 'GPT-6.1 Terra gpt-6.1-terra', 'terra')
  const effort = screen.getByRole('combobox', { name: 'Research effort' })
  expect(effort).toBeDisabled()
  expect(effort).toHaveDisplayValue('No effort levels')
})

test('a provider card saves its default model and effort as a pair', async () => {
  const api = client()
  await renderAgents(api)
  const claude = within(screen.getByRole('group', { name: 'Claude' }))
  expect(claude.getByText('Default model and effort')).toBeVisible()
  pick(
    claude.getByRole('combobox', { name: 'Default model' }),
    'Sonnet 5.5 claude-sonnet-5-5',
    'sonnet 5.5',
  )
  fireEvent.change(claude.getByRole('combobox', { name: 'Default effort' }), {
    target: { value: 'high' },
  })
  await autosaved(() =>
    expect(api.saveSettings).toHaveBeenCalledWith(
      expect.objectContaining({
        providers: expect.objectContaining({
          claude: {
            enabled: true,
            authentication: 'subscription',
            default_model: 'claude-sonnet-5-5',
            default_effort: 'high',
          },
        }),
      }),
    ),
  )
  expect(api.saveSettings).toHaveBeenCalledTimes(1)
})

test('the card says how many models were read, from where and when', async () => {
  await renderAgents(
    client(
      settings(),
      modelCatalog({ claude: providerCatalog(CLAUDE_MODELS, { read_at: READ_0912 }) }),
    ),
  )
  const time = eventTimeText(READ_0912, Date.now())!.replace('Today', 'today')
  expect(
    within(screen.getByRole('group', { name: 'Claude' })).getByText(
      `13 models · read from Claude Code in the agent VM ${time}`,
    ),
  ).toBeVisible()
})

test('a saved model no longer offered stays selected with its warning, and nothing is saved', async () => {
  const api = client(
    settings({ stage_selections: { images: { provider: 'claude', model: 'claude-opus-4-6' } } }),
  )
  await renderAgents(api)
  expect(screen.getByText('Claude · Opus 4.6')).toBeVisible()
  expect(
    screen.getByText(
      'Claude no longer lists claude-opus-4-6. New Images sessions will try it and fail if Claude refuses it. Pick another model.',
    ),
  ).toBeVisible()
  expect(screen.getAllByText('Not offered')).not.toHaveLength(0)
  await act(() => new Promise((resolve) => setTimeout(resolve, 900)))
  expect(api.saveSettings).not.toHaveBeenCalled()
})

test('a saved effort the model no longer accepts stays, with its own warning', async () => {
  await renderAgents(
    client(
      settings({
        stage_selections: {
          images: { provider: 'claude', model: 'claude-sonnet-4-6', effort: 'xhigh' },
        },
      }),
    ),
  )
  expect(screen.getByRole('combobox', { name: 'Images effort' })).toHaveDisplayValue('Extra high')
  expect(screen.getByText('Sonnet 4.6 takes no “Extra high”.')).toBeVisible()
  expect(screen.getByText('Not accepted')).toBeVisible()
})

test('while the first read runs, the saved model and effort are kept and Effort waits', async () => {
  const reading = modelCatalog({
    codex: builtinCatalog([...BUILT_IN_MODEL_CATALOG.codex], { state: 'reading' }),
  })
  await renderAgents(
    client(
      settings({
        stage_selections: { research: { provider: 'codex', model: 'gpt-6.2-sol', effort: 'high' } },
      }),
      reading,
    ),
  )
  expect(screen.getByText('Codex · gpt-6.2-sol')).toBeVisible()
  const effort = screen.getByRole('combobox', { name: 'Research effort' })
  expect(effort).toBeDisabled()
  expect(effort).toHaveDisplayValue('High')
  expect(
    within(screen.getByRole('group', { name: 'Codex' })).getByText('Reading Codex’s models…'),
  ).toBeVisible()
})

test('the built-in list is marked on the card and Effort offers only Default', async () => {
  const builtin = modelCatalog({ claude: builtinCatalog([...BUILT_IN_MODEL_CATALOG.claude]) })
  await renderAgents(
    client(
      settings({ stage_selections: { images: { provider: 'claude', model: 'claude-opus-5-5' } } }),
      builtin,
    ),
  )
  expect(
    within(screen.getByRole('group', { name: 'Claude' })).getByText(
      'Built-in list, may be out of date',
    ),
  ).toBeVisible()
  expect(optionTexts(screen.getByRole('combobox', { name: 'Images effort' }))).toEqual(['Default'])
})

test('Check again on a card asks for that provider’s list to be read again', async () => {
  const api = client()
  await renderAgents(api)
  fireEvent.click(
    within(screen.getByRole('group', { name: 'Codex' })).getByRole('button', {
      name: 'Check again',
    }),
  )
  await waitFor(() =>
    expect(api.refreshModelCatalog).toHaveBeenCalledExactlyOnceWith({ provider: 'codex' }),
  )
})

test('no warning while the list is from an earlier sign-in, and the view recovers when the new one lands', async () => {
  vi.useFakeTimers({ shouldAdvanceTime: true })
  vi.setSystemTime(NOW)
  const stale = modelCatalog({
    claude: providerCatalog(CLAUDE_MODELS, { state: 'stale_sign_in', read_at: READ_0912 }),
  })
  const api = client(
    settings({ stage_selections: { images: { provider: 'claude', model: 'claude-opus-4-6' } } }),
    stale,
  )
  await renderAgents(api)
  expect(screen.queryByText('Not offered')).not.toBeInTheDocument()
  expect(
    within(screen.getByRole('group', { name: 'Claude' })).getByText(/from an earlier sign-in/),
  ).toBeVisible()
  // A failed reread keeps it marked.
  api.modelCatalog.mockResolvedValue(
    modelCatalog({
      claude: providerCatalog(CLAUDE_MODELS, {
        state: 'stale_sign_in',
        read_at: READ_0912,
        failure: 'timeout',
      }),
    }),
  )
  await act(() => vi.advanceTimersByTimeAsync(1000))
  expect(screen.queryByText('Not offered')).not.toBeInTheDocument()
  api.modelCatalog.mockResolvedValue(modelCatalog())
  await act(() => vi.advanceTimersByTimeAsync(1000))
  expect(screen.getAllByText('Not offered')).not.toHaveLength(0)
})

test('the token dialog confirms only once the list is marked stale, and the card shows it at once', async () => {
  vi.useFakeTimers({ shouldAdvanceTime: true })
  vi.setSystemTime(NOW)
  const api = client()
  const send = vi.fn<typeof fetch>()
  vi.stubGlobal('fetch', send)
  send
    .mockResolvedValueOnce(Response.json({ configured: true, revision: 'one' }))
    .mockResolvedValueOnce(Response.json({ configured: true, revision: 'two' }))
  await renderAgents(api)
  const ack = deferred<AgentModelCatalogRefreshReceiptDto>()
  const held = deferred<AgentModelCatalogDto>()
  api.refreshModelCatalog.mockReturnValue(ack.promise)
  fireEvent.click(screen.getByRole('button', { name: 'Subscription token…' }))
  fireEvent.change(screen.getByLabelText('Personal runner management key'), {
    target: { value: 'operator' },
  })
  await act(() => vi.advanceTimersByTimeAsync(KEY_PAUSE_MS))
  fireEvent.change(screen.getByLabelText('Subscription token'), { target: { value: TOKEN } })
  fireEvent.click(await screen.findByRole('button', { name: 'Replace token' }))
  await waitFor(() =>
    expect(api.refreshModelCatalog).toHaveBeenCalledWith({
      provider: 'claude',
      authentication: 'subscription',
      invalidate: true,
    }),
  )
  // The dialog waits for the server to mark the list.
  expect(screen.getByRole('dialog')).toBeVisible()
  api.modelCatalog.mockReturnValue(held.promise)
  ack.resolve({ ...receipt, stale_sign_in: true })
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  expect(
    within(screen.getByRole('group', { name: 'Claude' })).getByText(/from an earlier sign-in/),
  ).toBeVisible()
  held.resolve(modelCatalog())
})

test('picking the model already chosen changes nothing, its effort included', async () => {
  const api = client(
    settings({
      stage_selections: {
        images: { provider: 'claude', model: 'claude-sonnet-4-6', effort: 'xhigh' },
      },
    }),
  )
  await renderAgents(api)
  fireEvent.change(screen.getByRole('combobox', { name: 'Images' }), {
    target: { value: 'claude-sonnet-4-6' },
  })
  fireEvent.click(screen.getByRole('option', { name: 'Older models (1)' }))
  fireEvent.click(screen.getByRole('option', { name: 'Sonnet 4.6 claude-sonnet-4-6' }))
  expect(screen.getByRole('combobox', { name: 'Images effort' })).toHaveValue('xhigh')
  await act(() => new Promise((resolve) => setTimeout(resolve, 900)))
  expect(api.saveSettings).not.toHaveBeenCalled()
})

test('a list from an earlier sign-in never resets the effort of a model picked from it', async () => {
  const stale = modelCatalog({
    claude: providerCatalog(CLAUDE_MODELS, { state: 'stale_sign_in', read_at: READ_0912 }),
  })
  const api = client(settings(), stale)
  await renderAgents(api)
  pick(screen.getByRole('combobox', { name: 'Images' }), 'Haiku 5.5 claude-haiku-5-5', 'haiku 5')
  expect(screen.queryByText(/Effort set to Default/)).not.toBeInTheDocument()
  await autosaved(() => expect(api.saveSettings).toHaveBeenCalledTimes(1))
  expect(api.saveSettings.mock.calls[0][0].stage_selections.images).toEqual({
    provider: 'claude',
    model: 'claude-haiku-5-5',
    effort: 'max',
  })
})
