import { randomUUID } from 'node:crypto'
import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { AgentSelectionDto } from '@invimport/contracts'
import { AgentChild, record } from './child.ts'
import type { NativeAgentHost } from './environment.ts'
import { CODEX_CONFIG, rejectHostCustomizations } from './codex.ts'

/** The MCP server name both providers see; tool names are `mcp__intake__<tool>`. */
export const SESSION_MCP_SERVER = 'intake'
export const SESSION_CAPABILITY_VARIABLE = 'INTAKE_TOOL_CAPABILITY'
const DELIVERY_POLL_MS = 500

export interface SessionTurn {
  instructions: string
  text: string
  /** The provider conversation to resume; omitted for a fresh session. */
  resume?: string
  toolUrl: string
  capability: string
  tools: readonly string[]
  /** Pending operator items to put into the running turn, as text. */
  nextDelivery: () => Promise<string | undefined>
  onStarted: (started: { providerSessionId: string; actualModel: string }) => Promise<void>
}

export class SessionResumeUnavailable extends Error {
  constructor() {
    super('resume_unavailable')
  }
}

/** Polls for operator items while a turn runs; stops when the turn ends or the signal aborts. */
function deliveryLoop(
  turn: SessionTurn,
  deliver: (text: string) => Promise<void>,
  signal: AbortSignal,
) {
  let stopped = false
  const done = (async () => {
    while (!stopped && !signal.aborted) {
      const text = await turn.nextDelivery()
      if (text !== undefined && !stopped) {
        await deliver(text)
        continue
      }
      await new Promise((resolve) => setTimeout(resolve, DELIVERY_POLL_MS))
    }
  })()
  return async () => {
    stopped = true
    await done.catch(() => undefined)
  }
}

/** Claude Code: app tools only, persistence on for resume, stdin stream-JSON for in-turn input. */
export async function runClaudeSession(
  host: NativeAgentHost,
  selection: AgentSelectionDto,
  turn: SessionTurn,
  cwd: string,
  env: NodeJS.ProcessEnv,
  signal: AbortSignal,
) {
  const mcpConfig = join(cwd, 'mcp.json')
  // The file names the variable, never the capability; the CLI expands it from the environment.
  await writeFile(
    mcpConfig,
    JSON.stringify({
      mcpServers: {
        [SESSION_MCP_SERVER]: {
          type: 'http',
          url: turn.toolUrl,
          headers: { Authorization: `Bearer \${${SESSION_CAPABILITY_VARIABLE}}` },
        },
      },
    }),
    { mode: 0o600 },
  )
  const sessionId = turn.resume ?? randomUUID()
  const args = [
    '-p',
    '--input-format',
    'stream-json',
    '--output-format',
    'stream-json',
    '--verbose',
    '--tools',
    '',
    '--strict-mcp-config',
    '--mcp-config',
    mcpConfig,
    '--setting-sources',
    '',
    '--allowedTools',
    `mcp__${SESSION_MCP_SERVER}__*`,
    '--model',
    selection.model,
    '--system-prompt',
    turn.instructions,
    ...(turn.resume ? ['--resume', turn.resume] : ['--session-id', sessionId]),
  ]
  if (selection.authentication === 'api_key') {
    args.push('--bare')
  }
  const child = new AgentChild(
    host.claudeExecutable,
    args,
    cwd,
    { ...env, [SESSION_CAPABILITY_VARIABLE]: turn.capability },
    signal,
  )
  const expectedTools = turn.tools.map((tool) => `mcp__${SESSION_MCP_SERVER}__${tool}`).sort()

  const userMessage = (text: string) => ({
    type: 'user',
    message: { role: 'user', content: [{ type: 'text', text }] },
  })

  let stopDelivery: (() => Promise<void>) | undefined
  let initialized = false
  try {
    await child.send(userMessage(turn.text))
    let finished = false
    while (true) {
      signal.throwIfAborted()
      const value = await child.next()
      if (value === undefined) {
        break
      }
      const message = record(value)
      if (message.type === 'system' && message.subtype === 'init') {
        const tools = Array.isArray(message.tools) ? [...message.tools].sort() : []
        const servers = Array.isArray(message.mcp_servers) ? message.mcp_servers.map(record) : []
        const onlyAppTools =
          JSON.stringify(tools) === JSON.stringify(expectedTools) &&
          servers.length === 1 &&
          servers[0].name === SESSION_MCP_SERVER &&
          servers[0].status === 'connected'
        if (initialized || message.session_id !== sessionId || typeof message.model !== 'string') {
          throw new Error('agent_protocol_invalid')
        }
        if (!onlyAppTools) {
          throw new Error('agent_tool_refused')
        }
        initialized = true
        await turn.onStarted({ providerSessionId: sessionId, actualModel: message.model })
        stopDelivery = deliveryLoop(turn, (text) => child.send(userMessage(text)), signal)
      }
      if (message.type === 'assistant') {
        const content = record(message.message).content
        if (!Array.isArray(content)) {
          throw new Error('agent_protocol_invalid')
        }
        for (const block of content.map(record)) {
          const appTool =
            block.type === 'tool_use' &&
            typeof block.name === 'string' &&
            expectedTools.includes(block.name)
          if (!appTool && !['text', 'thinking', 'redacted_thinking'].includes(String(block.type))) {
            throw new Error('agent_tool_refused')
          }
        }
      }
      if (message.type === 'result') {
        if (!initialized || message.session_id !== sessionId) {
          throw new Error('agent_protocol_invalid')
        }
        if (message.is_error !== false || message.subtype !== 'success') {
          throw new Error('agent_turn_failed')
        }
        finished = true
        await stopDelivery?.()
        child.endInput()
      }
    }
    if (!initialized && turn.resume) {
      throw new SessionResumeUnavailable()
    }
    if (!finished) {
      throw new Error('agent_result_missing')
    }
  } catch (error) {
    // A resume the CLI cannot honour exits before init, for example with a missing transcript.
    const exitedBeforeInit = error instanceof Error && error.message === 'agent_process_failed'
    if (!initialized && turn.resume && exitedBeforeInit) {
      throw new SessionResumeUnavailable()
    }
    throw error
  } finally {
    await stopDelivery?.()
    await child.close()
  }
}

/** The `/1` hardening keys, plus `features.goals` off so no goal tools are offered (design D2). */
const CODEX_SESSION_CONFIG: Record<string, unknown> = { ...CODEX_CONFIG, 'features.goals': false }

/** Codex app-server: one MCP server, pre-approved app tools, persisted threads and in-turn steer. */
export async function runCodexSession(
  host: NativeAgentHost,
  selection: AgentSelectionDto,
  turn: SessionTurn,
  cwd: string,
  env: NodeJS.ProcessEnv,
  signal: AbortSignal,
) {
  // The same dedicated-home preflight as `/1`, before any child starts.
  await rejectHostCustomizations(env.CODEX_HOME!)
  const args = ['app-server', '--listen', 'stdio://']
  const config = {
    ...CODEX_SESSION_CONFIG,
    forced_login_method: selection.authentication === 'subscription' ? 'chatgpt' : 'api',
  }
  for (const [key, value] of Object.entries(config)) {
    args.push('-c', `${key}=${JSON.stringify(value)}`)
  }
  args.push(
    '-c',
    `mcp_servers.${SESSION_MCP_SERVER}={url=${JSON.stringify(turn.toolUrl)},bearer_token_env_var="${SESSION_CAPABILITY_VARIABLE}",default_tools_approval_mode="approve"}`,
  )
  if (selection.authentication === 'api_key') {
    args.push(
      '-c',
      'model_provider="bench_openai"',
      '-c',
      'model_providers.bench_openai={name="Bench OpenAI",base_url="https://api.openai.com/v1",env_key="OPENAI_API_KEY",wire_api="responses",requires_openai_auth=false}',
    )
  }
  const child = new AgentChild(
    host.codexExecutable,
    args,
    cwd,
    { ...env, [SESSION_CAPABILITY_VARIABLE]: turn.capability },
    signal,
  )
  let sequence = 0
  const pending = new Map<number, (message: Record<string, unknown>) => void>()
  const notifications: Record<string, unknown>[] = []

  const send = async (method: string, params: unknown) => {
    const id = ++sequence
    const reply = new Promise<Record<string, unknown>>((resolve) => pending.set(id, resolve))
    await child.send({ id, method, params })
    return reply
  }

  /** The single reader: routes responses to their requests and keeps notifications in order. */
  const pump = async () => {
    const value = await child.next()
    if (value === undefined) {
      return false
    }
    const message = record(value)
    if ('method' in message && 'id' in message) {
      throw new Error('agent_tool_refused')
    }
    if ('id' in message) {
      const resolve = pending.get(Number(message.id))
      if (!resolve) {
        throw new Error('agent_protocol_invalid')
      }
      pending.delete(Number(message.id))
      resolve(message)
    } else {
      notifications.push(message)
    }
    return true
  }

  const request = async (method: string, params: unknown) => {
    const reply = send(method, params)
    let result: Record<string, unknown> | undefined
    void reply.then((value) => (result = value))
    while (!result) {
      signal.throwIfAborted()
      if (!(await pump())) {
        throw new Error('agent_protocol_invalid')
      }
      await Promise.resolve()
    }
    if ('error' in result) {
      throw new Error(`agent_request_refused:${method}`)
    }
    return record(result.result)
  }

  let stopDelivery: (() => Promise<void>) | undefined
  try {
    await request('initialize', {
      clientInfo: { name: 'bench_intake', version: '1' },
      capabilities: { experimentalApi: true },
    })
    await child.send({ method: 'initialized' })
    if (selection.authentication === 'subscription') {
      const account = await request('account/read', { refreshToken: false })
      if (!account.account || record(account.account).type !== 'chatgpt') {
        throw new Error('agent_login_required')
      }
    }
    let thread: Record<string, unknown>
    try {
      thread = turn.resume
        ? await request('thread/resume', { threadId: turn.resume, cwd, excludeTurns: true })
        : await request('thread/start', {
            model: selection.model,
            cwd,
            ephemeral: false,
            approvalPolicy: 'never',
            sandbox: 'read-only',
            baseInstructions: turn.instructions,
          })
    } catch (error) {
      if (turn.resume && String((error as Error).message).startsWith('agent_request_refused')) {
        throw new SessionResumeUnavailable()
      }
      throw error
    }
    const threadId = record(thread.thread).id
    if (typeof threadId !== 'string' || typeof thread.model !== 'string') {
      throw new Error('agent_protocol_invalid')
    }
    const effective = record((await request('config/read', { includeLayers: false, cwd })).config)
    const servers = Object.keys(record(effective.mcp_servers ?? {}))
    const status = await request('mcpServerStatus/list', {})
    const listed = Array.isArray(status.data) ? status.data.map(record) : []
    const intake = listed.find((server) => server.name === SESSION_MCP_SERVER)
    const tools = Object.keys(record(intake?.tools ?? {})).sort()
    if (
      servers.length !== 1 ||
      servers[0] !== SESSION_MCP_SERVER ||
      listed.length !== 1 ||
      JSON.stringify(tools) !== JSON.stringify([...turn.tools].sort())
    ) {
      throw new Error('agent_tool_refused')
    }
    await turn.onStarted({ providerSessionId: threadId, actualModel: thread.model })
    const started = await request('turn/start', {
      threadId,
      input: [{ type: 'text', text: turn.text, text_elements: [] }],
    })
    const turnId = record(started.turn).id
    if (typeof turnId !== 'string') {
      throw new Error('agent_protocol_invalid')
    }
    // A steer that misses the active turn leaves the item pending for read_inbox or resume.
    stopDelivery = deliveryLoop(
      turn,
      async (text) => {
        void send('turn/steer', {
          threadId,
          expectedTurnId: turnId,
          input: [{ type: 'text', text, text_elements: [] }],
        })
      },
      signal,
    )
    while (true) {
      signal.throwIfAborted()
      const completed = notifications.find((item) => item.method === 'turn/completed')
      if (completed) {
        const state = record(record(completed.params).turn).status
        if (state !== 'completed') {
          throw new Error('agent_turn_failed')
        }
        break
      }
      const failure = notifications.find((item) => item.method === 'error')
      if (failure) {
        throw new Error('agent_turn_failed')
      }
      if (!(await pump())) {
        throw new Error('agent_result_missing')
      }
    }
  } finally {
    await stopDelivery?.()
    child.endInput()
    await child.close()
  }
}
