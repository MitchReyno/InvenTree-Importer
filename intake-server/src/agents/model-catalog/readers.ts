// Where each profile and sign-in mode reads its model list, and the sign-in generation that list
// belongs to. The guest reads for shared-VM profiles; the session worker reads for host profiles.
import { createHmac } from 'node:crypto'
import { join } from 'node:path'
import type { AgentCatalogModelDto, AgentSelectionDto } from '@invimport/contracts'
import { AgentChild } from '#/agents/child.ts'
import { CODEX_CONFIG, rejectHostCustomizations } from '#/agents/codex.ts'
import { agentEnvironment, privateDirectory, type NativeAgentHost } from '#/agents/environment.ts'
import type { BridgeCatalogAnswer } from '#/agents/shared-vm/coordinator.ts'
import { readClaudeCliModels, readCodexCliModels } from './cli-readers.ts'
import {
  CatalogReadError,
  claudeApiModels,
  claudeCliModels,
  codexModels,
  openAiModelIds,
} from './normalise.ts'

export type CatalogProvider = AgentSelectionDto['provider']
export type CatalogAuthentication = AgentSelectionDto['authentication']

/** One read's list, normalised, with the sign-in generation it was read under (null: none). */
export interface CatalogRead {
  generation: string | null
  cliVersion: string | null
  models: AgentCatalogModelDto[]
}

export interface CatalogReader {
  readIn: 'vm' | 'host'
  source: 'cli' | 'api'
  /**
   * Whether the reader can say which sign-in a list belongs to. Without one (a host subscription,
   * whose sign-in the host CLI keeps for itself) a list is stored with no generation and no fence.
   */
  fenced: boolean
  /** Throws `CatalogReadError`; must stop and reap any process when `signal` aborts. */
  read(signal: AbortSignal): Promise<CatalogRead>
  /** The current sign-in generation, starting no CLI; null when the reader isn't fenced. */
  generation(signal: AbortSignal): Promise<string | null>
}

/** The bridge's catalogue requests, or a test double. */
export type GuestCatalog = (
  provider: CatalogProvider,
  kind: 'read' | 'generation',
  signal?: AbortSignal,
) => Promise<BridgeCatalogAnswer>

/** The guest's list for a subscription, read by its management process through the relay. */
export function guestReader(catalog: GuestCatalog, provider: CatalogProvider): CatalogReader {
  return {
    readIn: 'vm',
    source: 'cli',
    fenced: true,
    async read(signal) {
      const answer = await catalog(provider, 'read', signal)
      if (answer.kind === 'failure') {
        throw new CatalogReadError(answer.failure)
      }
      if (answer.kind !== 'read') {
        throw new CatalogReadError('malformed')
      }
      const raw = answer.read.raw
      if (provider === 'codex' && !Array.isArray(raw)) {
        throw new CatalogReadError('malformed')
      }
      const models = provider === 'claude' ? claudeCliModels(raw) : codexModels(raw as unknown[])
      return { generation: answer.read.generation, cliVersion: answer.read.cliVersion, models }
    },
    async generation(signal) {
      const answer = await catalog(provider, 'generation', signal)
      if (answer.kind === 'failure') {
        throw new CatalogReadError(answer.failure)
      }
      if (answer.kind !== 'generation') {
        throw new CatalogReadError('malformed')
      }
      return answer.generation
    },
  }
}

/** A directory of the worker's own for catalogue reads, so no CLI writes into a session's. */
async function scratch(host: NativeAgentHost) {
  return privateDirectory(join(host.stateRoot, 'model-catalog'))
}

function catalogSelection(
  provider: CatalogProvider,
  authentication: CatalogAuthentication,
): AgentSelectionDto {
  // No model is named: a catalogue read starts no turn.
  return { provider, authentication, model: 'catalog' }
}

/** The host Claude CLI's list for its own sign-in; never a models API. */
export function hostClaudeSubscriptionReader(host: NativeAgentHost): CatalogReader {
  return {
    readIn: 'host',
    source: 'cli',
    fenced: false,
    async read(signal) {
      const cwd = await scratch(host)
      const env = agentEnvironment(host, catalogSelection('claude', 'subscription'), cwd)
      const answer = await readClaudeCliModels(host.claudeExecutable, cwd, env, signal)
      return {
        generation: null,
        cliVersion: answer.cliVersion,
        models: claudeCliModels(answer.raw),
      }
    },
    generation: async () => null,
  }
}

function codexArgs(authentication: CatalogAuthentication) {
  const args = ['app-server', '--listen', 'stdio://']
  const config = {
    ...CODEX_CONFIG,
    forced_login_method: authentication === 'subscription' ? 'chatgpt' : 'api',
  }
  for (const [key, value] of Object.entries(config)) {
    args.push('-c', `${key}=${JSON.stringify(value)}`)
  }
  if (authentication === 'api_key') {
    args.push(
      '-c',
      'model_provider="bench_openai"',
      '-c',
      'model_providers.bench_openai={name="Bench OpenAI",base_url="https://api.openai.com/v1",env_key="OPENAI_API_KEY",wire_api="responses",requires_openai_auth=false}',
    )
  }
  return args
}

/** The host Codex app-server's `model/list` in the worker's dedicated home for that mode. */
async function hostCodexPages(
  host: NativeAgentHost,
  authentication: CatalogAuthentication,
  signal: AbortSignal,
) {
  const cwd = await scratch(host)
  const env = agentEnvironment(host, catalogSelection('codex', authentication), cwd)
  try {
    await rejectHostCustomizations(env.CODEX_HOME!)
  } catch {
    throw new CatalogReadError('unavailable')
  }
  const answer = await readCodexCliModels(
    () => new AgentChild(host.codexExecutable, codexArgs(authentication), cwd, env, signal),
  )
  if (!Array.isArray(answer.raw)) {
    throw new CatalogReadError('malformed')
  }
  return { cliVersion: answer.cliVersion, pages: answer.raw }
}

export function hostCodexSubscriptionReader(host: NativeAgentHost): CatalogReader {
  return {
    readIn: 'host',
    source: 'cli',
    fenced: false,
    async read(signal) {
      const { cliVersion, pages } = await hostCodexPages(host, 'subscription', signal)
      return { generation: null, cliVersion, models: codexModels(pages) }
    },
    generation: async () => null,
  }
}

/** The API key the worker holds for a provider, read each time so a changed key is seen. */
export type ApiKeySource = () => string | undefined

/** The worker's own key for API-key generations: an HMAC of the key, never the key. */
export function apiKeyGeneration(secret: string, provider: CatalogProvider, key: string) {
  const derived = createHmac('sha256', secret).update('bench-model-catalog/1').digest()
  return createHmac('sha256', derived)
    .update(provider + '\n' + key)
    .digest('hex')
    .slice(0, 32)
}

/** A provider models API's reply, bounded; `signed_out` when it refuses the key. */
async function fetchJson(
  fetcher: typeof fetch,
  url: string,
  headers: Record<string, string>,
  signal: AbortSignal,
) {
  let response: Response
  try {
    response = await fetcher(url, { headers, redirect: 'error', signal })
  } catch {
    throw new CatalogReadError(signal.aborted ? 'timeout' : 'unavailable')
  }
  if (response.status === 401 || response.status === 403) {
    await response.body?.cancel()
    throw new CatalogReadError('signed_out')
  }
  if (response.status !== 200) {
    await response.body?.cancel()
    throw new CatalogReadError('unavailable')
  }
  const text = await response.text().catch(() => {
    throw new CatalogReadError(signal.aborted ? 'timeout' : 'unavailable')
  })
  if (Buffer.byteLength(text) > MAX_MODELS_API_BYTES) {
    throw new CatalogReadError('malformed')
  }
  try {
    return JSON.parse(text) as unknown
  } catch {
    throw new CatalogReadError('malformed')
  }
}

/** A models API page is a few hundred bytes per model; anything this large is refused. */
const MAX_MODELS_API_BYTES = 1024 * 1024
/** Pages of Anthropic's models API read before the answer is refused as malformed. */
const MAX_ANTHROPIC_PAGES = 10
const ANTHROPIC_MODELS = 'https://api.anthropic.com/v1/models'
const OPENAI_MODELS = 'https://api.openai.com/v1/models'

function requireKey(keySource: ApiKeySource) {
  const key = keySource()?.trim()
  if (!key) {
    throw new CatalogReadError('signed_out')
  }
  return key
}

/** Anthropic's `GET /v1/models` with the key, every page. Never called with a subscription token. */
export function hostClaudeApiReader(
  secret: string,
  keySource: ApiKeySource,
  fetcher: typeof fetch = fetch,
): CatalogReader {
  return {
    readIn: 'host',
    source: 'api',
    fenced: true,
    async read(signal) {
      const key = requireKey(keySource)
      const pages: unknown[] = []
      let after: string | undefined
      for (;;) {
        const query = new URLSearchParams({ limit: '1000', ...(after ? { after_id: after } : {}) })
        const page = await fetchJson(
          fetcher,
          `${ANTHROPIC_MODELS}?${query}`,
          { 'x-api-key': key, 'anthropic-version': '2023-06-01' },
          signal,
        )
        pages.push(page)
        const body = page as Record<string, unknown> | null
        if (body?.has_more !== true) {
          break
        }
        if (typeof body.last_id !== 'string' || pages.length >= MAX_ANTHROPIC_PAGES) {
          throw new CatalogReadError('malformed')
        }
        after = body.last_id
      }
      return {
        generation: apiKeyGeneration(secret, 'claude', key),
        cliVersion: null,
        models: claudeApiModels(pages),
      }
    },
    generation: async () => apiKeyGeneration(secret, 'claude', requireKey(keySource)),
  }
}

/**
 * Codex with an API key: the catalogue built into the pinned Codex version, with each model the
 * key may use marked from OpenAI's `GET /v1/models`, which gives IDs only.
 */
export function hostCodexApiReader(
  host: NativeAgentHost,
  secret: string,
  keySource: ApiKeySource,
  fetcher: typeof fetch = fetch,
): CatalogReader {
  return {
    readIn: 'host',
    source: 'cli',
    fenced: true,
    async read(signal) {
      const key = requireKey(keySource)
      const { cliVersion, pages } = await hostCodexPages(host, 'api_key', signal)
      const usable = openAiModelIds(
        await fetchJson(fetcher, OPENAI_MODELS, { authorization: `Bearer ${key}` }, signal),
      )
      return {
        generation: apiKeyGeneration(secret, 'codex', key),
        cliVersion,
        models: codexModels(pages, usable),
      }
    },
    generation: async () => apiKeyGeneration(secret, 'codex', requireKey(keySource)),
  }
}

/**
 * The reader for each key under a worker's profile. Shared-VM profiles read subscriptions in the
 * guest; their API-key routes have no key in the guest (no relay passes one), so they keep the
 * built-in list. Host profiles read with the host CLI or, for API keys, the models APIs with the
 * key the worker holds. The synthetic profile reads nothing.
 */
export function profileCatalogReaders(options: {
  profileId: string
  host: NativeAgentHost
  secret: string
  guest?: GuestCatalog
  fetcher?: typeof fetch
}): (key: {
  provider: CatalogProvider
  authentication: CatalogAuthentication
}) => CatalogReader | undefined {
  const { host, secret, guest } = options
  const fetcher = options.fetcher ?? fetch

  const key = (name: string) => () => host.env[name]

  const vmProfile =
    options.profileId === 'shared-vm-agent/1' || options.profileId === 'shared-vm-agent/3'
  const readers = new Map<string, CatalogReader>()
  if (guest && (vmProfile || options.profileId === 'synthetic-session/1')) {
    readers.set('claude:subscription', guestReader(guest, 'claude'))
    readers.set('codex:subscription', guestReader(guest, 'codex'))
  } else if (options.profileId === 'native-agent/2') {
    readers.set('claude:subscription', hostClaudeSubscriptionReader(host))
    readers.set('codex:subscription', hostCodexSubscriptionReader(host))
    readers.set('claude:api_key', hostClaudeApiReader(secret, key('ANTHROPIC_API_KEY'), fetcher))
    readers.set('codex:api_key', hostCodexApiReader(host, secret, key('OPENAI_API_KEY'), fetcher))
  }
  return (catalogKey) => readers.get(catalogKey.provider + ':' + catalogKey.authentication)
}
