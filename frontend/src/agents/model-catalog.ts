import {
  BUILT_IN_MODEL_CATALOG,
  type AgentCatalogModelDto,
  type AgentCatalogState,
  type AgentEffortDto,
  type AgentModelCatalogDto,
  type AgentProviderCatalogDto,
  type AgentProviderId,
  type AgentSettingsDto,
  type AgentSettingsStage,
} from '@invimport/contracts'
import { eventTimeText } from '#/components/ui'

/** Every effort the providers name today, as the Effort select shows it. */
const EFFORT_LABEL: Record<string, string> = {
  low: 'Low',
  medium: 'Medium',
  high: 'High',
  xhigh: 'Extra high',
  max: 'Max',
}

/** An effort's words: a known level's label, otherwise the provider's value capitalised. */
export function effortLabel(effort: AgentEffortDto) {
  const known = EFFORT_LABEL[effort]
  if (known) {
    return known
  }
  return effort.charAt(0).toUpperCase() + effort.slice(1)
}

/**
 * One provider's list as the pickers use it. `waiting`: a read runs and there is no list to show
 * yet. `warns`: the list was read under the current sign-in, so a saved model or effort it lacks
 * is worth a warning; a built-in, earlier sign-in's or unconfirmed list never warns.
 */
export type ProviderCatalogView = {
  provider: AgentProviderId
  /** The server's state, or `unavailable` while the list couldn't be read from this server. */
  state: AgentCatalogState | 'unavailable'
  waiting: boolean
  builtin: boolean
  warns: boolean
  models: readonly AgentCatalogModelDto[]
  readAt: string | null
  readIn: AgentProviderCatalogDto['read_in']
  source: AgentProviderCatalogDto['source']
}

export type CatalogViews = Record<AgentProviderId, ProviderCatalogView>

/** The built-in list, for a provider whose list hasn't been read from this server. */
function unavailable(provider: AgentProviderId): ProviderCatalogView {
  return {
    provider,
    state: 'unavailable',
    waiting: false,
    builtin: true,
    warns: false,
    models: BUILT_IN_MODEL_CATALOG[provider],
    readAt: null,
    readIn: null,
    source: null,
  }
}

/**
 * Each provider's list, from the catalogue read. `current` is false while the read failed or
 * couldn't be sent, so what it last held may be out of date and raises no warning.
 */
export function catalogViews(
  catalog: AgentModelCatalogDto | undefined,
  current: boolean,
  authentication?: Record<AgentProviderId, AgentProviderCatalogDto['authentication']>,
): CatalogViews {
  const view = (provider: AgentProviderId) => {
    const read = catalog?.[provider]
    const otherSignIn =
      read !== undefined &&
      authentication !== undefined &&
      read.authentication !== authentication[provider]
    // A list for another sign-in method offers nothing until the saved one's is read.
    return otherSignIn ? awaiting(provider) : providerView(provider, read, current)
  }

  return { claude: view('claude'), codex: view('codex') }
}

/** A provider whose list for its sign-in method hasn't been read yet: the first read's state. */
function awaiting(provider: AgentProviderId): ProviderCatalogView {
  return { ...unavailable(provider), state: 'reading', waiting: true }
}

/**
 * One provider's view. `current` is false when the browser's read failed or couldn't be sent, so
 * the list raises no warning and decides nothing.
 */
function providerView(
  provider: AgentProviderId,
  read: AgentProviderCatalogDto | undefined,
  current: boolean,
): ProviderCatalogView {
  if (!read) {
    return unavailable(provider)
  }
  const readFromProvider = !read.builtin && read.state !== 'never_read'
  return {
    provider,
    state: read.state,
    waiting: read.state === 'reading' && read.builtin,
    builtin: read.builtin,
    warns: current && readFromProvider && read.state !== 'stale_sign_in',
    models: read.models,
    readAt: read.read_at,
    readIn: read.read_in,
    source: read.source,
  }
}

/** Whether the list is still settling: a read runs, or it is from an earlier sign-in. */
export function catalogBusy(catalog: AgentModelCatalogDto) {
  return [catalog.claude, catalog.codex].some(
    (read) => read.state === 'reading' || read.state === 'stale_sign_in',
  )
}

export function findModel(view: ProviderCatalogView, id: string) {
  return view.models.find((model) => model.id === id)
}

/**
 * A model's name: from the list shown, else from the built-in list, else its ID. While the first
 * read runs the saved choice shows by its ID.
 */
export function modelName(view: ProviderCatalogView, id: string) {
  if (view.waiting) {
    return id
  }
  const listed =
    findModel(view, id) ?? BUILT_IN_MODEL_CATALOG[view.provider].find((m) => m.id === id)
  return listed?.name ?? id
}

/** A saved model the provider's current list doesn't offer. */
export function notOffered(view: ProviderCatalogView, id: string) {
  return view.warns && id !== '' && !findModel(view, id)
}

/** A saved effort the chosen model, as the current list has it, doesn't accept. */
export function effortNotAccepted(
  view: ProviderCatalogView,
  id: string,
  effort: AgentEffortDto | undefined,
) {
  const model = findModel(view, id)
  return (
    view.warns && effort !== undefined && model !== undefined && !model.efforts.includes(effort)
  )
}

/**
 * Whether picking `id` drops `effort`: the model is in a list read under the current sign-in and
 * doesn't accept it. A model the list doesn't know, or a list that can't say, keeps it.
 */
export function effortDropped(
  view: ProviderCatalogView,
  id: string,
  effort: AgentEffortDto | undefined,
) {
  if (effort === undefined || !view.warns) {
    return false
  }
  const model = findModel(view, id)
  return model !== undefined && !model.efforts.includes(effort)
}

/** "Today 09:12" mid-sentence: "today 09:12". */
export function inSentence(time: string) {
  if (time.startsWith('Today ') || time.startsWith('Yesterday ')) {
    return time.charAt(0).toLowerCase() + time.slice(1)
  }
  return time
}

/** One choice in an Effort select: '' is Default, which sends no effort. */
export type EffortChoice = { value: AgentEffortDto | ''; label: string }

/** What an Effort select offers beside a model, and whether it can be changed. */
export type EffortChoices = { options: EffortChoice[]; disabled: boolean }

/** Default, naming the level the provider runs then when it says which. */
function defaultChoice(model: AgentCatalogModelDto | undefined): EffortChoice {
  const named = model?.default_effort
  return { value: '', label: named ? `Default · ${effortLabel(named)}` : 'Default' }
}

/** The saved effort as an option of its own, so a select never loses it. */
function keptChoice(saved: AgentEffortDto | undefined, listed: readonly string[]): EffortChoice[] {
  if (saved === undefined || listed.includes(saved)) {
    return []
  }

  return [{ value: saved, label: effortLabel(saved) }]
}

/**
 * The Effort select's options beside model `id`: Default and the levels the list says it takes,
 * in the provider's order, keeping a saved level it doesn't. While the first read runs it waits on
 * the saved value; the built-in list has no levels, so only Default; a listed model with none is
 * "No effort levels".
 */
export function effortChoices(
  view: ProviderCatalogView,
  id: string,
  saved: AgentEffortDto | undefined,
): EffortChoices {
  if (view.waiting) {
    const shown =
      saved === undefined ? defaultChoice(undefined) : { value: saved, label: effortLabel(saved) }
    return { options: [shown], disabled: true }
  }
  const model = view.builtin ? undefined : findModel(view, id)
  if (model && model.efforts.length === 0 && saved === undefined) {
    return { options: [{ value: '', label: 'No effort levels' }], disabled: true }
  }
  const levels = model?.efforts ?? []
  const options = [
    defaultChoice(model),
    ...levels.map((effort) => ({ value: effort, label: effortLabel(effort) })),
    ...keptChoice(saved, levels),
  ]

  return { options, disabled: false }
}

const SOURCE_WORDS: Record<AgentProviderId, Record<'cli' | 'api', string>> = {
  claude: { cli: 'Claude Code', api: 'Anthropic’s models API' },
  codex: { cli: 'Codex', api: 'OpenAI’s models API' },
}

const PLACE_WORDS = { vm: ' in the agent VM', host: ' on this server' }

const PROVIDER_NAME: Record<AgentProviderId, string> = { claude: 'Claude', codex: 'Codex' }

/**
 * The provider card's line about its list: "13 models · read from Claude Code in the agent VM
 * today 09:12", or that it is reading, built in, from an earlier sign-in or not read just now.
 */
export function catalogLine(view: ProviderCatalogView, now: number) {
  if (view.waiting) {
    return `Reading ${PROVIDER_NAME[view.provider]}’s models…`
  }
  if (view.builtin) {
    return 'Built-in list, may be out of date'
  }
  const count = view.models.length === 1 ? '1 model' : `${view.models.length} models`
  const source = view.source ? ` from ${SOURCE_WORDS[view.provider][view.source]}` : ''
  const place = view.readIn ? PLACE_WORDS[view.readIn] : ''
  const shownAt = view.readAt ? eventTimeText(view.readAt, now) : null
  const time = shownAt ? ` ${inSentence(shownAt)}` : ''
  const line = `${count} · read${source}${place}${time}`
  switch (view.state) {
    case 'stale_sign_in':
      return `${line} · from an earlier sign-in`
    case 'failed':
      return `${line} · couldn’t read just now`
    case 'current':
    case 'reading':
    case 'never_read':
    case 'unavailable':
      return line
  }
}

/** The model a step's new sessions run: its own while its provider is on, else the default's. */
export function stepModel(
  settings: AgentSettingsDto,
  stage: AgentSettingsStage,
): { provider: AgentProviderId; model: string } | null {
  const own = settings.stage_selections[stage]
  if (own && settings.providers[own.provider].enabled) {
    return own
  }
  const provider = settings.default_provider

  return provider ? { provider, model: settings.providers[provider].default_model } : null
}
