// Reads a provider's model list from its CLI without starting a turn: Claude's `initialize`
// control request, and Codex app-server's `model/list`. Shared by the host worker and the guest.
import { randomUUID } from 'node:crypto'
import { AgentChild } from '#/agents/child.ts'
import { NativeSessionError } from '#/agents/failure-model.ts'
import { CatalogReadError } from './normalise.ts'

/** What a CLI answered, before normalisation; the version is null when it didn't say. */
export interface CliCatalogAnswer {
  cliVersion: string | null
  /** Claude: `models[]`. Codex: the `model/list` pages in order. */
  raw: unknown
}

const CLI_VERSION = /^\d{1,4}\.\d{1,4}\.\d{1,4}$/
/** Codex pages beyond this are refused as malformed rather than read without end. */
const MAX_CODEX_PAGES = 10

function record(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return undefined
  }
  return value as Record<string, unknown>
}

function version(value: unknown) {
  return typeof value === 'string' && CLI_VERSION.test(value) ? value : null
}

/**
 * The flags a catalogue read starts Claude with: no tools, MCP servers, slash commands or setting
 * sources, so neither the user's hooks nor plugins run. Only `initialize` is ever written.
 */
export const CLAUDE_CATALOG_ARGS = [
  '-p',
  '--input-format',
  'stream-json',
  '--output-format',
  'stream-json',
  '--verbose',
  '--tools',
  '',
  '--disable-slash-commands',
  '--strict-mcp-config',
  '--setting-sources',
  '',
]

/** A CLI that failed before answering: a fixed code, so its output never reaches the table. */
function unavailableCli(error: unknown): never {
  if (error instanceof CatalogReadError) {
    throw error
  }
  if (error instanceof NativeSessionError && error.message === 'agent_cancelled') {
    throw new CatalogReadError('timeout')
  }
  if (
    error instanceof NativeSessionError &&
    ['agent_protocol_invalid', 'agent_frame_capacity', 'agent_output_capacity'].includes(
      error.message,
    )
  ) {
    throw new CatalogReadError('malformed')
  }
  throw new CatalogReadError('unavailable')
}

/**
 * Sends `initialize` and returns the reply's `models[]` and version, then closes the CLI's input
 * and reaps it. A reap that isn't confirmed throws `ResearchReapPendingError`.
 */
export async function readClaudeCliModels(
  executable: string,
  cwd: string,
  env: NodeJS.ProcessEnv,
  signal: AbortSignal,
): Promise<CliCatalogAnswer> {
  const child = new AgentChild(executable, CLAUDE_CATALOG_ARGS, cwd, env, signal)
  try {
    const id = randomUUID()
    await child.send({
      type: 'control_request',
      request_id: id,
      request: { subtype: 'initialize' },
    })
    for (;;) {
      const frame = record(await child.next())
      if (!frame) {
        throw new CatalogReadError('malformed')
      }
      const response = record(frame.response)
      if (frame.type !== 'control_response' || response?.request_id !== id) {
        continue
      }
      const reply = record(response.response)
      if (response.subtype !== 'success' || !reply) {
        throw new CatalogReadError('unavailable')
      }
      child.endInput()
      return { cliVersion: version(reply.claude_code_version), raw: reply.models }
    }
  } catch (error) {
    return unavailableCli(error)
  } finally {
    await child.close()
  }
}

/** One JSON-RPC exchange with an app-server; notifications between replies are skipped. */
export interface CodexRpc {
  request(method: string, params: unknown): Promise<Record<string, unknown>>
}

/** Reads every `model/list` page, after the caller's `initialize`, which gives the version. */
export async function listCodexModels(rpc: CodexRpc): Promise<unknown[]> {
  const pages: unknown[] = []
  let cursor: string | null = null
  do {
    const page: Record<string, unknown> = await rpc.request(
      'model/list',
      cursor === null ? {} : { cursor },
    )
    pages.push(page)
    const next = page.nextCursor
    if (next !== null && next !== undefined && typeof next !== 'string') {
      throw new CatalogReadError('malformed')
    }
    cursor = next ?? null
    if (pages.length >= MAX_CODEX_PAGES && cursor !== null) {
      throw new CatalogReadError('malformed')
    }
  } while (cursor !== null)
  return pages
}

/** The version Codex's `initialize` reports in its user agent, or null. */
export function codexVersion(userAgent: unknown) {
  if (typeof userAgent !== 'string') {
    return null
  }
  return version(/^bench_intake\/(\d+\.\d+\.\d+)(?: |$)/.exec(userAgent)?.[1])
}

/** A JSON-RPC client over a running app-server child. */
export function childRpc(child: AgentChild): CodexRpc {
  let sequence = 0
  return {
    async request(method, params) {
      const id = ++sequence
      await child.send({ id, method, params })
      for (;;) {
        const message = record(await child.next())
        if (!message) {
          throw new CatalogReadError('malformed')
        }
        if (message.id !== id) {
          continue
        }
        if ('error' in message) {
          throw new CatalogReadError('unavailable')
        }
        return record(message.result) ?? {}
      }
    },
  }
}

/**
 * Starts an app-server child and reads its model list; `start` builds the child, so the guest can
 * wrap it in the account lock turns take. The child is reaped before this returns.
 */
export async function readCodexCliModels(start: () => AgentChild): Promise<CliCatalogAnswer> {
  let child: AgentChild | undefined
  try {
    child = start()
    const rpc = childRpc(child)
    const initialized = await rpc.request('initialize', {
      clientInfo: { name: 'bench_intake', version: '1' },
    })
    await child.send({ method: 'initialized' })
    const pages = await listCodexModels(rpc)
    child.endInput()
    return { cliVersion: codexVersion(initialized.userAgent), raw: pages }
  } catch (error) {
    return unavailableCli(error)
  } finally {
    await child?.close()
  }
}
