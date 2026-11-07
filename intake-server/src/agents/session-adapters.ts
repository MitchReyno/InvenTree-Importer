import { NativeSessionError } from './failure-model.ts'
import { randomUUID } from 'node:crypto'
import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { AgentSelectionDto } from '@invimport/contracts'
import { AgentChild, record } from './child.ts'
import type { NativeAgentHost } from './environment.ts'
import { admitClaudeSession } from './claude-session-admission.ts'
import { CODEX_CONFIG, rejectHostCustomizations } from './codex.ts'
import {
  hasAdmission,
  rememberAdmission,
  requireCodexSessionConfig,
  requireCodexSessionVersion,
  requireClaudeSessionVersion,
  requireClaudeSessionConfig,
} from './session-admission.ts'

/** The MCP server name both providers see; tool names are `mcp__intake__<tool>`. */
export const SESSION_MCP_SERVER = 'intake'
export const SESSION_CAPABILITY_VARIABLE = 'INTAKE_TOOL_CAPABILITY'
const DELIVERY_POLL_MS = 500

export interface SessionTurn {
  onCliVersion?: (version: string) => void
  instructions: string
  text: string
  /** The provider conversation to resume; omitted for a fresh session. */
  resume?: string
  toolUrl: string
  capability: string
  tools: readonly string[]
  /** Pending operator items to put into the running turn, as text. */
  nextDelivery: () => Promise<{ text: string; seq: bigint } | undefined>
  /** Called for each item the CLI accepted into the running turn. */
  onDelivered: (seq: bigint) => void
  onStarted: (started: { providerSessionId: string; actualModel: string }) => Promise<void>
}

export class SessionResumeUnavailable extends NativeSessionError {
  constructor() {
    super('resume_unavailable')
  }
}

/**
 * Polls for operator items while a turn runs; stops when the turn ends or the signal aborts. A
 * failure is handed to `fail` at once, which aborts the turn so the child is reaped first.
 */
function deliveryLoop(
  turn: SessionTurn,
  deliver: (text: string) => Promise<boolean>,
  signal: AbortSignal,
  fail: (error: unknown) => void,
) {
  let stopped = false

  let release: () => void = () => {}

  const stopping = new Promise<false>((resolve) => (release = () => resolve(false)))
  const done = (async () => {
    try {
      while (!stopped && !signal.aborted) {
        const item = await turn.nextDelivery()
        if (item !== undefined && !stopped) {
          // A reply that never comes (the turn ended first) counts as not delivered.
          if (await Promise.race([deliver(item.text), stopping])) {
            turn.onDelivered(item.seq)
          }
          continue
        }
        await new Promise((resolve) => setTimeout(resolve, DELIVERY_POLL_MS))
      }
    } catch (error) {
      fail(error)
    }
  })()
  return async () => {
    stopped = true
    release()
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
  if (turn.resume && !(await hasAdmission(cwd, selection, turn.resume))) {
    throw new SessionResumeUnavailable()
  }
  await requireClaudeSessionVersion(host.claudeExecutable, cwd, env, signal, turn.onCliVersion)
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
    '--disable-slash-commands',
    '--disallowedTools',
    'advisor',
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
  const local = new AbortController()
  let deliveryFailure = false

  const failDelivery = () => {
    deliveryFailure = true
    local.abort()
  }

  const turnSignal = AbortSignal.any([signal, local.signal])
  const child = new AgentChild(
    host.claudeExecutable,
    args,
    cwd,
    { ...env, [SESSION_CAPABILITY_VARIABLE]: turn.capability },
    turnSignal,
  )
  const expectedTools = turn.tools.map((tool) => `mcp__${SESSION_MCP_SERVER}__${tool}`).sort()

  const userMessage = (text: string) => ({
    type: 'user',
    message: { role: 'user', content: [{ type: 'text', text }] },
  })

  let stopDelivery: (() => Promise<void>) | undefined
  let initialized = false
  try {
    await admitClaudeSession(child, turn.tools, turnSignal)
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
        requireClaudeSessionConfig(message)
        const tools = Array.isArray(message.tools) ? [...message.tools].sort() : []
        const servers = Array.isArray(message.mcp_servers) ? message.mcp_servers.map(record) : []
        const onlyAppTools =
          JSON.stringify(tools) === JSON.stringify(expectedTools) &&
          servers.length === 1 &&
          servers[0].name === SESSION_MCP_SERVER &&
          servers[0].status === 'connected'
        if (initialized || message.session_id !== sessionId || typeof message.model !== 'string') {
          throw new NativeSessionError('agent_protocol_invalid')
        }
        if (!onlyAppTools) {
          throw new NativeSessionError('agent_tool_refused')
        }
        if (typeof message.claude_code_version === 'string') {
          turn.onCliVersion?.(message.claude_code_version)
        }
        initialized = true
        await rememberAdmission(cwd, selection, sessionId)
        await turn.onStarted({ providerSessionId: sessionId, actualModel: message.model })
        stopDelivery = deliveryLoop(
          turn,
          async (text) => {
            await child.send(userMessage(text))
            return true
          },
          turnSignal,
          failDelivery,
        )
      }
      if (message.type === 'assistant') {
        const content = record(message.message).content
        if (!Array.isArray(content)) {
          throw new NativeSessionError('agent_protocol_invalid')
        }
        for (const block of content.map(record)) {
          const appTool =
            block.type === 'tool_use' &&
            typeof block.name === 'string' &&
            expectedTools.includes(block.name)
          if (!appTool && !['text', 'thinking', 'redacted_thinking'].includes(String(block.type))) {
            throw new NativeSessionError('agent_tool_refused')
          }
        }
      }
      if (message.type === 'result') {
        if (!initialized || message.session_id !== sessionId) {
          throw new NativeSessionError('agent_protocol_invalid')
        }
        if (message.is_error !== false || message.subtype !== 'success') {
          throw new NativeSessionError('agent_turn_failed')
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
      throw new NativeSessionError('agent_result_missing')
    }
  } catch (error) {
    if (deliveryFailure) {
      throw new NativeSessionError('agent_delivery_failed')
    }
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

/** Qualified `/2` settings; `/1` retains its independent compatibility policy. */
const CODEX_SESSION_CONFIG: Record<string, unknown> = {
  ...CODEX_CONFIG,
  'features.goals': false,
  'features.code_mode.enabled': false,
  'skills.include_instructions': false,
}

/** Codex app-server: one MCP server, pre-approved app tools, persisted threads and in-turn steer. */
export async function runCodexSession(
  host: NativeAgentHost,
  selection: AgentSelectionDto,
  turn: SessionTurn,
  cwd: string,
  env: NodeJS.ProcessEnv,
  signal: AbortSignal,
) {
  if (turn.resume && !(await hasAdmission(cwd, selection, turn.resume))) {
    throw new SessionResumeUnavailable()
  }
  // The same dedicated-home preflight as `/1`, before any child starts.
  await rejectHostCustomizations(env.CODEX_HOME!)
  const args = ['app-server', '--strict-config', '--listen', 'stdio://']
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
  const local = new AbortController()
  let deliveryFailure = false

  const failDelivery = () => {
    deliveryFailure = true
    local.abort()
  }

  const turnSignal = AbortSignal.any([signal, local.signal])
  const child = new AgentChild(
    host.codexExecutable,
    args,
    cwd,
    { ...env, [SESSION_CAPABILITY_VARIABLE]: turn.capability },
    turnSignal,
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
      throw new NativeSessionError('agent_tool_refused')
    }
    if (message.method === 'item/started' || message.method === 'item/completed') {
      requireAppItem(record(record(message.params).item), turn.tools)
    }
    if ('id' in message) {
      const resolve = pending.get(Number(message.id))
      if (!resolve) {
        throw new NativeSessionError('agent_protocol_invalid')
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
        throw new NativeSessionError('agent_protocol_invalid')
      }
      await Promise.resolve()
    }
    if ('error' in result) {
      throw new NativeSessionError('agent_request_refused')
    }
    return record(result.result)
  }

  let stopDelivery: (() => Promise<void>) | undefined
  try {
    const initialized = await request('initialize', {
      clientInfo: { name: 'bench_intake', version: '1' },
      capabilities: { experimentalApi: true },
    })
    const version =
      typeof initialized.userAgent === 'string'
        ? /^bench_intake\/(\d+\.\d+\.\d+)(?: |$)/.exec(initialized.userAgent)?.[1]
        : undefined
    if (version) {
      turn.onCliVersion?.(version)
    }
    requireCodexSessionVersion(initialized.userAgent)
    await child.send({ method: 'initialized' })
    if (selection.authentication === 'subscription') {
      const account = await request('account/read', { refreshToken: false })
      if (!account.account || record(account.account).type !== 'chatgpt') {
        throw new NativeSessionError('agent_login_required')
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
      throw new NativeSessionError('agent_protocol_invalid')
    }
    // The effective policy, as for earlier profiles: no approvals, read-only, the chosen provider.
    if (
      thread.approvalPolicy !== 'never' ||
      record(thread.sandbox).type !== 'readOnly' ||
      thread.modelProvider !== (selection.authentication === 'api_key' ? 'bench_openai' : 'openai')
    ) {
      throw new NativeSessionError('agent_policy_refused')
    }
    const effective = record((await request('config/read', { includeLayers: false, cwd })).config)
    requireCodexSessionConfig(effective)
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
      throw new NativeSessionError('agent_tool_refused')
    }
    if (turn.resume && threadId !== turn.resume) {
      throw new SessionResumeUnavailable()
    }
    await rememberAdmission(cwd, selection, threadId)
    await turn.onStarted({ providerSessionId: threadId, actualModel: thread.model })
    const started = await request('turn/start', {
      threadId,
      input: [{ type: 'text', text: turn.text, text_elements: [] }],
    })
    const turnId = record(started.turn).id
    if (typeof turnId !== 'string') {
      throw new NativeSessionError('agent_protocol_invalid')
    }
    // A steer that misses the active turn leaves the item pending for read_inbox or resume.
    stopDelivery = deliveryLoop(
      turn,
      async (text) => {
        // A refused steer leaves the item for read_inbox or a resume; a failed write aborts the turn.
        const reply = await send('turn/steer', {
          threadId,
          expectedTurnId: turnId,
          input: [{ type: 'text', text, text_elements: [] }],
        })
        return !('error' in reply)
      },
      turnSignal,
      failDelivery,
    )
    while (true) {
      turnSignal.throwIfAborted()
      const completed = notifications.find((item) => item.method === 'turn/completed')
      if (completed) {
        const state = record(record(completed.params).turn).status
        if (state !== 'completed') {
          throw new NativeSessionError('agent_turn_failed')
        }
        break
      }
      const failure = notifications.find((item) => item.method === 'error')
      if (failure) {
        throw new NativeSessionError('agent_turn_failed')
      }
      if (!(await pump())) {
        throw new NativeSessionError('agent_result_missing')
      }
    }
  } catch (error) {
    if (deliveryFailure) {
      throw new NativeSessionError('agent_delivery_failed')
    }
    throw error
  } finally {
    await stopDelivery?.()
    child.endInput()
    await child.close()
  }
}

/** Item types an app-tools session can produce; anything else, such as a command, is refused. */
const SESSION_ITEM_TYPES = new Set([
  'userMessage',
  'agentMessage',
  'reasoning',
  'contextCompaction',
])

function requireAppItem(item: Record<string, unknown>, tools: readonly string[]) {
  if (SESSION_ITEM_TYPES.has(String(item.type))) {
    return
  }
  const appCall =
    item.type === 'mcpToolCall' &&
    item.server === SESSION_MCP_SERVER &&
    typeof item.tool === 'string' &&
    tools.includes(item.tool)
  if (!appCall) {
    throw new NativeSessionError('agent_tool_refused')
  }
}
