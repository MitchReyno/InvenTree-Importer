import { NativeSessionError } from '#/agents/failure-model.ts'
import { randomUUID } from 'node:crypto'
import { setTimeout as delay } from 'node:timers/promises'
import { AgentChild, record } from '#/agents/child.ts'

const ADMISSION_TIMEOUT_MS = 15_000
const MCP_READY_POLL_MS = 100

async function control(child: AgentChild, subtype: string) {
  const id = randomUUID()
  await child.send({ type: 'control_request', request_id: id, request: { subtype } })
  const frame = record(await child.next())
  const response = record(frame.response)
  if (
    frame.type !== 'control_response' ||
    response.request_id !== id ||
    response.subtype !== 'success'
  ) {
    throw new NativeSessionError('agent_policy_refused')
  }
  if (
    Array.isArray(response.pending_permission_requests) &&
    response.pending_permission_requests.length
  ) {
    throw new NativeSessionError('agent_tool_refused')
  }
  return record(response.response)
}

const BUILTIN_AGENTS = ['claude', 'Explore', 'general-purpose', 'Plan', 'statusline-setup']
/** Subscription sessions also list web-fetch, inert because no Agent tool is offered. */
const ADMITTED_AGENT_SETS = [BUILTIN_AGENTS, [...BUILTIN_AGENTS, 'web-fetch']].map((set) =>
  JSON.stringify([...set].sort()),
)

function requireConfiguration(config: Record<string, unknown>) {
  const actualAgents = Array.isArray(config.agents)
    ? config.agents.map((agent) => record(agent).name).sort()
    : []
  if (
    config.claude_code_version !== '2.1.319' ||
    config.current_permission_mode !== 'default' ||
    config.output_style !== 'default' ||
    config.session_state !== 'idle' ||
    !Array.isArray(config.commands) ||
    config.commands.length !== 0 ||
    !ADMITTED_AGENT_SETS.includes(JSON.stringify(actualAgents))
  ) {
    throw new NativeSessionError('agent_policy_refused')
  }
}

async function inspect(child: AgentChild, tools: readonly string[], signal: AbortSignal) {
  requireConfiguration(await control(child, 'initialize'))
  while (true) {
    signal.throwIfAborted()
    const status = await control(child, 'mcp_status')
    const servers = Array.isArray(status.mcpServers) ? status.mcpServers.map(record) : []
    if (servers.length !== 1 || servers[0].name !== 'intake') {
      throw new NativeSessionError('agent_tool_refused')
    }
    const server = servers[0]
    if (server.status === 'pending') {
      await delay(MCP_READY_POLL_MS, undefined, { signal })
      continue
    }
    const names = Array.isArray(server.tools)
      ? server.tools.map((tool) => record(tool).name).sort()
      : []
    if (
      server.status !== 'connected' ||
      JSON.stringify(names) !== JSON.stringify([...tools].sort())
    ) {
      throw new NativeSessionError('agent_tool_refused')
    }
    return
  }
}

/** No user input is sent until the idle control protocol admits configuration and MCP tools. */
export async function admitClaudeSession(
  child: AgentChild,
  tools: readonly string[],
  signal: AbortSignal,
) {
  let timer: ReturnType<typeof setTimeout> | undefined
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () => reject(new NativeSessionError('agent_admission_timeout')),
      ADMISSION_TIMEOUT_MS,
    )
  })
  try {
    await Promise.race([inspect(child, tools, signal), deadline])
  } finally {
    clearTimeout(timer)
  }
}
