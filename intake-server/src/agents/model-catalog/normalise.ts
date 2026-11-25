// Turns each provider's answer into catalogue entries before anything is stored. Every reader's
// answer passes through here, so nothing a CLI or models API sends reaches the table unchecked.
import {
  MAX_CATALOG_BYTES,
  MAX_CATALOG_MODELS,
  validationIssues,
  type AgentCatalogFailure,
  type AgentCatalogModelDto,
} from '@invimport/contracts'

/** A read that failed, with the fixed code the table keeps; never the provider's text. */
export class CatalogReadError extends Error {
  constructor(readonly code: AgentCatalogFailure) {
    super(code)
  }
}

const MODEL_ID = /^[a-zA-Z0-9][a-zA-Z0-9._:/-]{0,127}$/
const EFFORT = /^[a-z][a-z0-9_-]{0,31}$/
/** Claude's model IDs carry the major version after the family: `claude-opus-4-8`. */
const CLAUDE_MAJOR = /^claude-[a-z]+-(\d+)(?:-|$)/
/** Approved on the board: Claude 4.x and earlier are older whatever else the list holds. */
const OLDEST_CURRENT_CLAUDE_MAJOR = 5

function malformed(): never {
  throw new CatalogReadError('malformed')
}

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return malformed()
  }
  return value as Record<string, unknown>
}

function list(value: unknown): unknown[] {
  if (!Array.isArray(value)) {
    return malformed()
  }
  return value
}

function text(value: unknown): string {
  if (typeof value !== 'string' || value.length === 0) {
    return malformed()
  }
  return value
}

function efforts(levels: unknown): string[] {
  const values = list(levels).map((level) => text(level))
  if (!values.every((level) => EFFORT.test(level))) {
    return malformed()
  }
  return values
}

/**
 * The list as stored: each entry valid against the contract, within the model count, and the
 * whole within the row's byte limit.
 */
export function checkedCatalog(models: AgentCatalogModelDto[]): AgentCatalogModelDto[] {
  if (models.length > MAX_CATALOG_MODELS) {
    return malformed()
  }
  if (models.some((model) => validationIssues('AgentCatalogModel', model).length > 0)) {
    return malformed()
  }
  if (Buffer.byteLength(JSON.stringify(models)) > MAX_CATALOG_BYTES) {
    return malformed()
  }
  return models
}

function claudeMajor(id: string) {
  const major = CLAUDE_MAJOR.exec(id)?.[1]
  return major === undefined ? undefined : Number(major)
}

/** Older: major 4 or lower, or below the newest major the list holds. */
function markOlderClaude(models: AgentCatalogModelDto[]) {
  const majors = models.map((model) => claudeMajor(model.id))
  const known = majors.filter((major): major is number => major !== undefined)
  const newest = known.length ? Math.max(...known) : undefined
  return models.map((model, index) => {
    const major = majors[index]
    const older =
      major !== undefined &&
      (major < OLDEST_CURRENT_CLAUDE_MAJOR || (newest !== undefined && major < newest))
    return { ...model, older }
  })
}

interface ClaudeCliEntry {
  value: string
  id: string
  displayName: string
  efforts: string[]
}

function claudeCliEntry(raw: unknown): ClaudeCliEntry | undefined {
  const entry = record(raw)
  const value = text(entry.value)
  const resolved = entry.resolvedModel === undefined ? value : text(entry.resolvedModel)
  const displayName = text(entry.displayName)
  const levels = entry.supportsEffort === true ? efforts(entry.supportedEffortLevels ?? []) : []
  // An ID the model ID check refuses, such as `opus[1m]`, can't be saved or sent.
  if (!MODEL_ID.test(resolved)) {
    return undefined
  }
  return { value, id: resolved, displayName, efforts: levels }
}

/** The entry whose name and efforts stand for its model: the exact one, then a named alias. */
function representative(entries: ClaudeCliEntry[]) {
  return (
    entries.find((entry) => entry.value === entry.id) ??
    entries.find((entry) => entry.value !== 'default') ??
    entries[0]
  )
}

/**
 * The pinned Claude CLI's `initialize` `models[]`: aliases fold into the exact model they resolve
 * to, in first-seen order, and `default` marks the model the CLI's default resolves to.
 */
export function claudeCliModels(models: unknown): AgentCatalogModelDto[] {
  const groups = new Map<string, ClaudeCliEntry[]>()
  let defaultId: string | undefined
  for (const raw of list(models)) {
    const entry = claudeCliEntry(raw)
    if (!entry) {
      continue
    }
    if (entry.value === 'default') {
      defaultId = entry.id
    }
    const group = groups.get(entry.id) ?? []
    group.push(entry)
    groups.set(entry.id, group)
  }
  const folded = [...groups.entries()].map(([id, entries]) => {
    const chosen = representative(entries)
    const name = chosen.value === 'default' && entries.length === 1 ? id : chosen.displayName
    return {
      id,
      name,
      older: false,
      default: id === defaultId,
      efforts: chosen.efforts,
      default_effort: null,
      usable: null,
    }
  })
  return checkedCatalog(markOlderClaude(folded))
}

function claudeApiEfforts(capabilities: unknown) {
  if (capabilities === undefined || capabilities === null) {
    return []
  }
  const effort = record(capabilities).effort
  if (effort === undefined || effort === null) {
    return []
  }
  const levels = record(effort)
  if (levels.supported !== true) {
    return []
  }
  const supported = Object.entries(levels).filter(
    ([level, value]) => level !== 'supported' && record(value).supported === true,
  )
  return efforts(supported.map(([level]) => level))
}

/** Anthropic's `GET /v1/models` pages: names without "Claude ", efforts from `capabilities`. */
export function claudeApiModels(pages: unknown[]): AgentCatalogModelDto[] {
  const models = pages.flatMap((page) =>
    list(record(page).data).map((raw) => {
      const entry = record(raw)
      const id = text(entry.id)
      if (!MODEL_ID.test(id)) {
        return malformed()
      }
      return {
        id,
        name: text(entry.display_name).replace(/^Claude /, ''),
        older: false,
        default: false,
        efforts: claudeApiEfforts(entry.capabilities),
        default_effort: null,
        usable: null,
      }
    }),
  )
  return checkedCatalog(markOlderClaude(models))
}

/** The model IDs OpenAI's `GET /v1/models` lists for a key. */
export function openAiModelIds(body: unknown): Set<string> {
  return new Set(list(record(body).data).map((raw) => text(record(raw).id)))
}

/**
 * Codex app-server `model/list` pages, in order, without hidden models. `usable`, given for an API
 * key, marks the models the key may use; otherwise every entry's mark is null.
 */
export function codexModels(
  pages: unknown[],
  usable?: ReadonlySet<string>,
): AgentCatalogModelDto[] {
  const models: AgentCatalogModelDto[] = []
  for (const page of pages) {
    for (const raw of list(record(page).data)) {
      const entry = record(raw)
      if (typeof entry.hidden !== 'boolean' || typeof entry.isDefault !== 'boolean') {
        return malformed()
      }
      if (entry.hidden) {
        continue
      }
      const id = text(entry.model)
      const levels = list(entry.supportedReasoningEfforts).map(
        (option) => record(option).reasoningEffort,
      )
      const defaultEffort = text(entry.defaultReasoningEffort)
      if (!MODEL_ID.test(id) || !EFFORT.test(defaultEffort)) {
        return malformed()
      }
      models.push({
        id,
        name: text(entry.displayName),
        older: false,
        default: entry.isDefault,
        efforts: efforts(levels),
        default_effort: defaultEffort,
        usable: usable ? usable.has(id) : null,
      })
    }
  }
  return checkedCatalog(models)
}
