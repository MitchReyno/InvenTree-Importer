import type { GroupBase } from 'react-select'
import type { AgentCatalogModelDto, AgentProviderId } from '@invimport/contracts'
import { eventTimeText } from '#/components/ui'
import {
  findModel,
  inSentence,
  modelName,
  notOffered,
  type CatalogViews,
  type ProviderCatalogView,
} from '#/agents/model-catalog'
import { MODEL_ID, PROVIDER_LABEL } from './provider-form'

/** A provider and one of its models; the model may be an exact ID that isn't listed. */
export type ModelChoice = { provider: AgentProviderId; model: string }

/**
 * What a model picker's menu holds. Notes say how the list stands and pick nothing; Try again and
 * the older group's toggle act within the menu.
 */
export type ModelOption =
  | { kind: 'default'; label: string }
  | {
      kind: 'model'
      provider: AgentProviderId
      model: string
      name: string
      /** An API key's list says this key can't use it. */
      unusable: boolean
    }
  | { kind: 'note'; provider: AgentProviderId; text: string; tone: 'warn' | 'quiet' | 'reading' }
  | { kind: 'retry'; provider: AgentProviderId }
  | { kind: 'older'; provider: AgentProviderId; count: number; open: boolean }
  | { kind: 'exact'; provider: AgentProviderId; model: string }
  | { kind: 'invalid'; model: string }

export type ModelOptions = (ModelOption | GroupBase<ModelOption>)[]

/** The accessible text of an option, which its drawing below matches word for word. */
export function modelOptionText(option: ModelOption) {
  switch (option.kind) {
    case 'default':
      return option.label
    case 'model': {
      const id = option.name === option.model ? '' : ` ${option.model}`
      return `${option.name}${id}${option.unusable ? ' Key can’t use' : ''}`
    }
    case 'note':
      return option.text
    case 'retry':
      return 'Try again'
    case 'older':
      return option.open ? 'Hide older models' : `Older models (${option.count})`
    case 'exact':
      return `Use “${option.model}” with ${PROVIDER_LABEL[option.provider]}`
    case 'invalid':
      return `“${option.model}” isn’t a model ID: use letters, digits and . _ : / -`
  }
}

export function offReason(provider: AgentProviderId) {
  return `Turn ${PROVIDER_LABEL[provider]} on to use its models`
}

function matches(text: string, query: string) {
  return text.toLowerCase().includes(query.toLowerCase())
}

function modelOption(provider: AgentProviderId, model: AgentCatalogModelDto): ModelOption {
  return {
    kind: 'model',
    provider,
    model: model.id,
    name: model.name,
    unusable: model.usable === false,
  }
}

/** The chosen model's option, named from the list where it can be. */
export function chosenOption(view: ProviderCatalogView, choice: ModelChoice): ModelOption {
  const listed = findModel(view, choice.model)
  return {
    kind: 'model',
    provider: choice.provider,
    model: choice.model,
    name: modelName(view, choice.model),
    unusable: listed?.usable === false,
  }
}

/** How the provider's list stands, said inside it: read failed, built-in or from an earlier sign-in. */
function stateNotes(view: ProviderCatalogView, now: number): ModelOption[] {
  const provider = view.provider
  const name = PROVIDER_LABEL[provider]
  const shownAt = view.readAt ? eventTimeText(view.readAt, now) : null
  if (view.builtin) {
    return [{ kind: 'note', provider, text: 'Built-in list, may be out of date', tone: 'quiet' }]
  }
  switch (view.state) {
    case 'failed':
      return [
        {
          kind: 'note',
          provider,
          tone: 'warn',
          text: `Couldn’t read ${name}’s models just now.${shownAt ? ` Showing the list from ${inSentence(shownAt)}.` : ''}`,
        },
        { kind: 'retry', provider },
      ]
    case 'stale_sign_in':
      return [
        {
          kind: 'note',
          provider,
          tone: 'quiet',
          text: `From an earlier sign-in${shownAt ? `, read ${inSentence(shownAt)}` : ''}.`,
        },
      ]
    case 'current':
    case 'reading':
    case 'never_read':
    case 'unavailable':
      return []
  }
}

type GroupInput = {
  view: ProviderCatalogView
  query: string
  /** The current choice, when it is this provider's. */
  chosen: ModelChoice | null
  olderOpen: boolean
  now: number
}

/**
 * One provider's group: how its list stands, its current models, a saved model the list doesn't
 * hold (unless the list is one that warns of it), then the older models folded behind a toggle.
 * While the first read runs it holds only that note and the saved model.
 */
function providerGroup({ view, query, chosen, olderOpen, now }: GroupInput) {
  const provider = view.provider

  const found = (model: AgentCatalogModelDto) =>
    !query ||
    matches(model.name, query) ||
    matches(model.id, query) ||
    matches(PROVIDER_LABEL[provider], query)

  const unlisted = chosen && chosen.model && !findModel(view, chosen.model) ? chosen : null
  const keptUnlisted =
    unlisted && !notOffered(view, unlisted.model) && (!query || matches(unlisted.model, query))
  const savedOption = keptUnlisted ? [chosenOption(view, unlisted)] : []

  if (view.waiting) {
    const reading: ModelOption = {
      kind: 'note',
      provider,
      tone: 'reading',
      text: `Reading ${PROVIDER_LABEL[provider]}’s models…`,
    }
    const saved = chosen?.model && (!query || matches(chosen.model, query))
    return saved ? [reading, chosenOption(view, chosen)] : [reading]
  }

  const current = view.models.filter((model) => !model.older && found(model))
  const older = view.models.filter((model) => model.older && found(model))
  const options: ModelOption[] = [
    ...current.map((model) => modelOption(provider, model)),
    ...savedOption,
  ]
  if (older.length > 0) {
    options.push({ kind: 'older', provider, count: older.length, open: olderOpen })
    if (olderOpen) {
      options.push(...older.map((model) => modelOption(provider, model)))
    }
  }
  if (options.length === 0) {
    return []
  }

  return [...stateNotes(view, now), ...options]
}

/** Whether `query` is a model ID some provider's group already lists. */
function listedAnywhere(
  query: string,
  providers: readonly AgentProviderId[],
  catalogs: CatalogViews,
) {
  return providers.some((provider) => findModel(catalogs[provider], query))
}

/** The exact-ID options for a typed query, when it names no model this picker lists. */
function exactOptions(
  query: string,
  providers: readonly AgentProviderId[],
  selectable: Record<AgentProviderId, boolean>,
  catalogs: CatalogViews,
  value: ModelChoice | null,
): ModelOption[] {
  // A listed model is picked from its own group, never offered again as a typed ID.
  if (listedAnywhere(query, providers, catalogs) || value?.model === query) {
    return []
  }
  const offered = providers.filter((provider) => selectable[provider])
  if (offered.length === 0) {
    return []
  }
  if (!MODEL_ID.test(query)) {
    return [{ kind: 'invalid', model: query }]
  }

  return offered.map((provider) => ({ kind: 'exact', provider, model: query }))
}

export type MenuInput = {
  providers: readonly AgentProviderId[]
  selectable: Record<AgentProviderId, boolean>
  catalogs: CatalogViews
  value: ModelChoice | null
  fallback?: string
  query: string
  olderOpen: Record<AgentProviderId, boolean>
  now: number
}

/**
 * The menu: a saved model the current list no longer offers first, then Default, each provider's
 * group, and a typed exact ID once per provider that can be picked.
 */
export function modelMenu({
  providers,
  selectable,
  catalogs,
  value,
  fallback,
  query,
  olderOpen,
  now,
}: MenuInput): ModelOptions {
  const list: ModelOptions = []
  if (value && notOffered(catalogs[value.provider], value.model)) {
    list.push({
      label: 'Saved, not offered',
      options: [chosenOption(catalogs[value.provider], value)],
    })
  }
  // Default is found by its own name, not by the model it currently stands for.
  if (fallback && (!query || matches('Default', query))) {
    list.push({ kind: 'default', label: fallback })
  }
  for (const provider of providers) {
    const name = PROVIDER_LABEL[provider]
    const options = providerGroup({
      view: catalogs[provider],
      query,
      chosen: value?.provider === provider ? value : null,
      olderOpen: olderOpen[provider],
      now,
    })
    if (options.length > 0) {
      list.push({
        label: selectable[provider] ? name : `${name} · ${offReason(provider)}`,
        options,
      })
    }
  }
  if (query) {
    list.push(...exactOptions(query, providers, selectable, catalogs, value))
  }

  return list
}
