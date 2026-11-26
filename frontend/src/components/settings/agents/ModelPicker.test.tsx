import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { StrictMode } from 'react'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { BUILT_IN_MODEL_CATALOG, type AgentModelCatalogDto } from '@invimport/contracts'
import { catalogViews } from '#/agents/model-catalog'
import { eventTimeText } from '#/components/ui'
import {
  builtinCatalog,
  catalogModel,
  CLAUDE_MODELS,
  CODEX_MODELS,
  modelCatalog,
  providerCatalog,
} from '#/test/model-catalog'
import { ModelPicker } from './ModelPicker'

type Props = Parameters<typeof ModelPicker>[0]

const NOW = new Date(2026, 10, 26, 10, 0)
const TODAY_0912 = new Date(2026, 10, 26, 9, 12).toISOString()
const YESTERDAY_1640 = new Date(2026, 10, 25, 16, 40).toISOString()

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(NOW)
})

afterEach(() => {
  vi.useRealTimers()
})

function picker(props: Partial<Props> = {}, catalog: AgentModelCatalogDto = modelCatalog()) {
  const onChange = vi.fn()
  const onRetry = vi.fn()
  render(
    <StrictMode>
      <ModelPicker
        label="Research model"
        providers={['claude', 'codex']}
        selectable={{ claude: true, codex: true }}
        value={null}
        fallback="Default · Claude Opus 5.5"
        catalogs={catalogViews(catalog, true)}
        onChange={onChange}
        onRetry={onRetry}
        {...props}
      />
    </StrictMode>,
  )
  return {
    onChange,
    onRetry,
    input: screen.getByRole('combobox', { name: props.label ?? 'Research model' }),
  }
}

const optionNames = () => screen.getAllByRole('option').map((option) => option.textContent)

const claudeOnly = {
  label: 'Default model',
  providers: ['claude'] as const,
  fallback: undefined,
}

test('lists each model by name with its exact ID, Claude’s older ones folded away', async () => {
  const user = userEvent.setup()
  const { input } = picker(claudeOnly)
  await user.click(input)
  expect(optionNames()).toEqual([
    'Fable 5.2 claude-fable-5-2',
    'Opus 5.5 claude-opus-5-5',
    'Sonnet 5.5 claude-sonnet-5-5',
    'Haiku 5.5 claude-haiku-5-5',
    'Fable 5.1 claude-fable-5-1',
    'Sonnet 5 claude-sonnet-5',
    'Opus 5 claude-opus-5',
    'Fable 5 claude-fable-5',
    'Older models (5)',
  ])
  // Opening the group keeps the menu open, with the older models after the current ones.
  await user.click(screen.getByRole('option', { name: 'Older models (5)' }))
  expect(optionNames().slice(-6)).toEqual([
    'Hide older models',
    'Haiku 4.5 claude-haiku-4-5-20251001',
    'Opus 4.8 claude-opus-4-8',
    'Opus 4.7 claude-opus-4-7',
    'Sonnet 4.6 claude-sonnet-4-6',
    'Opus 4.1 claude-opus-4-1',
  ])
})

test('search by name or ID; the older group keeps what matches folded', async () => {
  const user = userEvent.setup()
  const { input, onChange } = picker()
  await user.type(input, 'son')
  expect(optionNames()).toEqual([
    'Sonnet 5.5 claude-sonnet-5-5',
    'Sonnet 5 claude-sonnet-5',
    'Older models (1)',
    'Use “son” with Claude',
    'Use “son” with Codex',
  ])
  await user.click(screen.getByRole('option', { name: 'Older models (1)' }))
  expect(input).toHaveValue('son')
  expect(screen.getByRole('option', { name: 'Sonnet 4.6 claude-sonnet-4-6' })).toBeVisible()
  await user.clear(input)
  await user.type(input, 'gpt-6.2-s')
  expect(optionNames()).toEqual([
    'GPT-6.2-Sol gpt-6.2-sol',
    'Use “gpt-6.2-s” with Claude',
    'Use “gpt-6.2-s” with Codex',
  ])
  await user.click(screen.getByRole('option', { name: 'GPT-6.2-Sol gpt-6.2-sol' }))
  expect(onChange).toHaveBeenCalledExactlyOnceWith({ provider: 'codex', model: 'gpt-6.2-sol' })
})

test('a step’s choice reads by provider and name, and Default sets the step back', async () => {
  const user = userEvent.setup()
  const { input, onChange } = picker({ value: { provider: 'codex', model: 'gpt-6.2-sol' } })
  expect(screen.getByText('Codex · GPT-6.2-Sol')).toBeVisible()
  await user.click(input)
  await user.click(screen.getByRole('option', { name: 'Default · Claude Opus 5.5' }))
  expect(onChange).toHaveBeenCalledExactlyOnceWith(null)
})

test('a list holding only 4.x Claude models keeps them all in the folded group', async () => {
  const user = userEvent.setup()
  const older = CLAUDE_MODELS.filter((model) => model.older)
  const { input } = picker(claudeOnly, modelCatalog({ claude: providerCatalog(older) }))
  await user.click(input)
  expect(optionNames()).toEqual(['Older models (5)'])
})

test('a saved model the current list no longer offers comes first, by its name', async () => {
  const user = userEvent.setup()
  const { input } = picker({ value: { provider: 'claude', model: 'claude-opus-4-6' } })
  expect(screen.getByText('Claude · Opus 4.6')).toBeVisible()
  await user.click(input)
  expect(screen.getAllByRole('option')[0]).toHaveTextContent('Opus 4.6 claude-opus-4-6')
  expect(screen.getByText('Saved, not offered')).toBeVisible()
})

test('a model an API key can’t use says so and can still be chosen', async () => {
  const user = userEvent.setup()
  const catalog = modelCatalog({
    codex: providerCatalog(
      [
        catalogModel('gpt-6.2-sol', 'GPT-6.2-Sol', { usable: true }),
        catalogModel('gpt-5.5', 'GPT-5.5', { usable: false }),
      ],
      { authentication: 'api_key', read_in: 'host' },
    ),
  })
  const { input, onChange } = picker({ providers: ['codex'], fallback: undefined }, catalog)
  await user.click(input)
  const blocked = screen.getByRole('option', { name: 'GPT-5.5 gpt-5.5 Key can’t use' })
  expect(blocked).not.toHaveAttribute('aria-disabled', 'true')
  await user.click(blocked)
  expect(onChange).toHaveBeenCalledExactlyOnceWith({ provider: 'codex', model: 'gpt-5.5' })
})

test('an off provider’s models show greyed with the reason; exact IDs stay checked and offered once', async () => {
  const user = userEvent.setup()
  const { input, onChange } = picker({ selectable: { claude: true, codex: false } })
  await user.click(input)
  expect(screen.getByText('Codex · Turn Codex on to use its models')).toBeVisible()
  const sol = screen.getByRole('option', { name: 'GPT-6.2-Sol gpt-6.2-sol' })
  expect(sol).toHaveAttribute('aria-disabled', 'true')
  await user.click(sol)
  expect(onChange).not.toHaveBeenCalled()
  await user.type(input, 'claude-next-5')
  expect(optionNames()).toEqual(['Use “claude-next-5” with Claude'])
  await user.click(screen.getByRole('option', { name: 'Use “claude-next-5” with Claude' }))
  expect(onChange).toHaveBeenCalledExactlyOnceWith({ provider: 'claude', model: 'claude-next-5' })
  onChange.mockClear()
  await user.type(input, 'not a model!')
  const refused = screen.getByRole('option', { name: /“not a model!” isn’t a model ID/ })
  expect(refused).toHaveAttribute('aria-disabled', 'true')
  // A listed model's exact ID isn't offered again.
  await user.clear(input)
  await user.type(input, 'claude-opus-5-5')
  expect(optionNames()).toEqual(['Opus 5.5 claude-opus-5-5'])
})

test('while the first read runs, the saved model shows by its ID and an exact ID is still taken', async () => {
  const user = userEvent.setup()
  const catalog = modelCatalog({
    codex: builtinCatalog([...BUILT_IN_MODEL_CATALOG.codex], { state: 'reading' }),
  })
  const { input, onChange } = picker(
    {
      providers: ['codex'],
      fallback: undefined,
      value: { provider: 'codex', model: 'gpt-6.2-sol' },
    },
    catalog,
  )
  expect(screen.getByText('gpt-6.2-sol')).toBeVisible()
  await user.click(input)
  expect(optionNames()).toEqual(['Reading Codex’s models…', 'gpt-6.2-sol'])
  expect(screen.getByRole('option', { name: 'Reading Codex’s models…' })).toHaveAttribute(
    'aria-disabled',
    'true',
  )
  await user.type(input, 'gpt-7')
  await user.click(screen.getByRole('option', { name: 'Use “gpt-7” with Codex' }))
  expect(onChange).toHaveBeenCalledExactlyOnceWith({ provider: 'codex', model: 'gpt-7' })
})

test('a failed read keeps the last list with its time, and Try again asks for a read', async () => {
  const user = userEvent.setup()
  const catalog = modelCatalog({
    claude: providerCatalog(CLAUDE_MODELS, {
      state: 'failed',
      read_at: YESTERDAY_1640,
      failure: 'timeout',
    }),
  })
  const { input, onRetry, onChange } = picker(claudeOnly, catalog)
  await user.click(input)
  const time = eventTimeText(YESTERDAY_1640, Date.now())!.replace('Yesterday', 'yesterday')
  expect(optionNames().slice(0, 3)).toEqual([
    `Couldn’t read Claude’s models just now. Showing the list from ${time}.`,
    'Try again',
    'Fable 5.2 claude-fable-5-2',
  ])
  await user.click(screen.getByRole('option', { name: 'Try again' }))
  expect(onRetry).toHaveBeenCalledExactlyOnceWith('claude')
  expect(onChange).not.toHaveBeenCalled()
  expect(screen.getByRole('listbox')).toBeVisible()
})

test('the built-in list is marked, and a list from an earlier sign-in says so with no warning', async () => {
  const user = userEvent.setup()
  const builtin = modelCatalog({ claude: builtinCatalog([...BUILT_IN_MODEL_CATALOG.claude]) })
  const first = picker(claudeOnly, builtin)
  await user.click(first.input)
  expect(optionNames()[0]).toBe('Built-in list, may be out of date')
  document.body.innerHTML = ''

  const stale = modelCatalog({
    claude: providerCatalog(CLAUDE_MODELS, { state: 'stale_sign_in', read_at: TODAY_0912 }),
  })
  const second = picker(
    { ...claudeOnly, value: { provider: 'claude', model: 'claude-opus-4-6' } },
    stale,
  )
  await user.click(second.input)
  const time = eventTimeText(TODAY_0912, Date.now())!.replace('Today', 'today')
  expect(optionNames()[0]).toBe(`From an earlier sign-in, read ${time}.`)
  expect(screen.queryByText('Saved, not offered')).not.toBeInTheDocument()
})

test('Codex’s listed models need no catalogue of Claude’s to be picked', async () => {
  const user = userEvent.setup()
  const { input } = picker({ providers: ['codex'], fallback: undefined })
  await user.click(input)
  expect(optionNames()).toEqual(CODEX_MODELS.map((model) => `${model.name} ${model.id}`))
})

test('while the first read runs, a typed ID of the hidden built-in list is still offered', async () => {
  const user = userEvent.setup()
  const catalog = modelCatalog({
    codex: builtinCatalog([...BUILT_IN_MODEL_CATALOG.codex], { state: 'reading' }),
  })
  const { input } = picker(
    {
      providers: ['codex'],
      fallback: undefined,
      value: { provider: 'codex', model: 'gpt-6.2-sol' },
    },
    catalog,
  )
  await user.type(input, 'gpt-6.1-sol')
  expect(screen.getByRole('option', { name: 'Use “gpt-6.1-sol” with Codex' })).toBeVisible()
})

test('a search that matches nothing keeps the failed read’s note and Try again', async () => {
  const user = userEvent.setup()
  const catalog = modelCatalog({
    claude: providerCatalog(CLAUDE_MODELS, { state: 'failed', read_at: YESTERDAY_1640 }),
  })
  const { input } = picker(claudeOnly, catalog)
  await user.type(input, 'claude-next-9')
  expect(screen.getByRole('option', { name: 'Try again' })).toBeVisible()
  expect(
    screen.getByRole('option', { name: /^Couldn’t read Claude’s models just now/ }),
  ).toBeVisible()
})
