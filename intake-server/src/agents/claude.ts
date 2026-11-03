import { randomUUID } from 'node:crypto'
import type { AgentSelectionDto } from '@invimport/contracts'
import { AgentChild, record } from './child.ts'
import type { NativeAgentHost } from './environment.ts'
import { NativeAgentResult, decodeNativeResult } from './result.ts'
import type { NativePrompt, NativeProgress } from './types.ts'

async function requireSubscription(
  host: NativeAgentHost,
  cwd: string,
  env: NodeJS.ProcessEnv,
  signal: AbortSignal,
) {
  const child = new AgentChild(
    host.claudeExecutable,
    ['--safe-mode', 'auth', 'status', '--json'],
    cwd,
    env,
    signal,
    'json',
  )
  try {
    const status = record(await child.next())
    if (
      status.loggedIn !== true ||
      status.authMethod !== 'claude.ai' ||
      status.apiProvider !== 'firstParty'
    ) {
      throw new Error('agent_login_required')
    }
    if ((await child.next()) !== undefined) {
      throw new Error('agent_auth_status_invalid')
    }
  } finally {
    await child.close()
  }
}

/** Subscription remains inside the unmodified host CLI; API-key mode never reads its keychain. */
export async function runClaude(
  host: NativeAgentHost,
  selection: AgentSelectionDto,
  prompt: NativePrompt,
  cwd: string,
  env: NodeJS.ProcessEnv,
  signal: AbortSignal,
  progress: NativeProgress,
) {
  if (selection.authentication === 'subscription') {
    await requireSubscription(host, cwd, env, signal)
  }
  const sessionId = randomUUID()
  const args = [
    '--safe-mode',
    '-p',
    '--input-format',
    'stream-json',
    '--output-format',
    'stream-json',
    '--verbose',
    '--include-partial-messages',
    '--tools',
    '',
    '--strict-mcp-config',
    '--mcp-config',
    '{"mcpServers":{}}',
    '--setting-sources',
    '',
    '--no-session-persistence',
    '--session-id',
    sessionId,
    '--model',
    selection.model,
    '--system-prompt',
    prompt.instructions,
    '--json-schema',
    JSON.stringify(NativeAgentResult),
  ]
  if (selection.authentication === 'api_key') {
    args.push('--bare')
  }
  const child = new AgentChild(host.claudeExecutable, args, cwd, env, signal)
  try {
    const content = [
      { type: 'text', text: prompt.text },
      ...prompt.images.map((image) => ({
        type: 'image',
        source: { type: 'base64', media_type: image.mediaType, data: image.base64 },
      })),
    ]
    await child.send({ type: 'user', message: { role: 'user', content } })
    child.endInput()
    let outcome: unknown
    let initialized = false
    let finished = false
    while (true) {
      signal.throwIfAborted()
      const value = await child.next()
      if (value === undefined) {
        break
      }
      const message = record(value)
      if (message.type === 'system' && message.subtype === 'init') {
        if (initialized || message.session_id !== sessionId || typeof message.model !== 'string') {
          throw new Error('agent_protocol_invalid')
        }
        if (
          !Array.isArray(message.tools) ||
          message.tools.some((tool) => tool !== 'StructuredOutput')
        ) {
          throw new Error('agent_tool_refused')
        }
        initialized = true
        await progress({
          nativeSessionId: sessionId,
          actualModel: message.model,
          progress: 'responding',
        })
      }
      if (message.type === 'assistant') {
        const content = record(message.message).content
        if (!Array.isArray(content)) {
          throw new Error('agent_protocol_invalid')
        }
        for (const block of content) {
          const item = record(block)
          if (item.type === 'tool_use' && item.name === 'StructuredOutput') {
            continue
          }
          if (!['text', 'thinking', 'redacted_thinking'].includes(String(item.type))) {
            throw new Error('agent_tool_refused')
          }
        }
      }
      if (message.type === 'result') {
        if (
          finished ||
          !initialized ||
          message.session_id !== sessionId ||
          message.is_error !== false ||
          message.subtype !== 'success'
        ) {
          throw new Error('agent_turn_failed')
        }
        outcome = message.structured_output
        finished = true
      }
    }
    if (!finished) {
      throw new Error('agent_result_missing')
    }
    return decodeNativeResult(outcome)
  } finally {
    await child.close()
  }
}
