import { lstat } from 'node:fs/promises'
import { join } from 'node:path'
import type { AgentSelectionDto } from '@invimport/contracts'
import { AgentChild, record } from './child.ts'
import type { NativeAgentHost } from './environment.ts'
import { NativeAgentResult, decodeNativeResult } from './result.ts'
import type { NativePrompt, NativeProgress } from './types.ts'

const CODEX_CONFIG: Record<string, unknown> = {
  approval_policy: 'never',
  sandbox_mode: 'read-only',
  web_search: 'disabled',
  'features.shell_tool': false,
  'features.view_image': false,
  'features.apps': false,
  'features.plugins': false,
  'features.remote_plugin': false,
  'features.memories': false,
  'features.multi_agent': false,
  'features.request_permissions_tool': false,
  'skills.bundled.enabled': false,
  'history.persistence': 'none',
}

async function rejectHostCustomizations(home: string) {
  for (const name of ['config.toml', 'hooks.json', 'skills', 'plugins']) {
    try {
      await lstat(join(home, name))
    } catch (error) {
      if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') {
        continue
      }
      throw new Error('agent_home_unavailable')
    }
    throw new Error('agent_home_customizations_refused')
  }
}

/** Uses only the documented app-server protocol, never reads or copies the CLI authentication store. */
export async function runCodex(
  host: NativeAgentHost,
  selection: AgentSelectionDto,
  prompt: NativePrompt,
  cwd: string,
  env: NodeJS.ProcessEnv,
  signal: AbortSignal,
  progress: NativeProgress,
) {
  await rejectHostCustomizations(env.CODEX_HOME!)
  const config = {
    ...CODEX_CONFIG,
    forced_login_method: selection.authentication === 'subscription' ? 'chatgpt' : 'api',
  }
  const args = ['app-server', '--listen', 'stdio://']
  for (const [key, value] of Object.entries(config)) {
    args.push('-c', `${key}=${JSON.stringify(value)}`)
  }
  if (selection.authentication === 'api_key') {
    args.push(
      '-c',
      'model_provider="bench_openai"',
      '-c',
      'model_providers.bench_openai={name="Bench OpenAI",base_url="https://api.openai.com/v1",env_key="OPENAI_API_KEY",wire_api="responses",requires_openai_auth=false}',
    )
  }
  const child = new AgentChild(host.codexExecutable, args, cwd, env, signal)
  let sequence = 0
  const notifications: Record<string, unknown>[] = []

  const request = async (method: string, params: unknown) => {
    const id = ++sequence
    await child.send({ id, method, params })
    while (true) {
      signal.throwIfAborted()
      const message = record(await child.next())
      if ('method' in message && 'id' in message) {
        throw new Error('agent_tool_refused')
      }
      if (message.id === id) {
        if ('error' in message) {
          throw new Error('agent_request_refused')
        }
        return record(message.result)
      }
      if ('id' in message) {
        throw new Error('agent_protocol_invalid')
      }
      notifications.push(message)
    }
  }

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
    const started = await request('thread/start', {
      model: selection.model,
      cwd,
      ephemeral: true,
      approvalPolicy: 'never',
      sandbox: 'read-only',
      baseInstructions: prompt.instructions,
    })
    const sandbox = record(started.sandbox)
    if (
      started.approvalPolicy !== 'never' ||
      sandbox.type !== 'readOnly' ||
      started.modelProvider !== (selection.authentication === 'api_key' ? 'bench_openai' : 'openai')
    ) {
      throw new Error('agent_policy_refused')
    }
    const threadId = record(started.thread).id
    if (typeof threadId !== 'string' || typeof started.model !== 'string') {
      throw new Error('agent_protocol_invalid')
    }
    await progress({
      nativeSessionId: threadId,
      actualModel: started.model,
      progress: 'responding',
    })
    const turn = await request('turn/start', {
      threadId,
      model: selection.model,
      input: [
        { type: 'text', text: prompt.text },
        ...prompt.images.map((image) => ({
          type: 'image',
          url: `data:${image.mediaType};base64,${image.base64}`,
        })),
      ],
      outputSchema: NativeAgentResult,
      approvalPolicy: 'never',
      sandboxPolicy: { type: 'readOnly', networkAccess: false },
    })
    const turnId = record(turn.turn).id
    if (typeof turnId !== 'string') {
      throw new Error('agent_protocol_invalid')
    }
    let final: string | undefined
    while (true) {
      signal.throwIfAborted()
      const message = notifications.shift() ?? record(await child.next())
      if ('id' in message) {
        throw new Error('agent_tool_refused')
      }
      if (typeof message.method !== 'string') {
        throw new Error('agent_protocol_invalid')
      }
      if (message.method === 'item/completed') {
        const params = record(message.params)
        if (params.threadId !== threadId || params.turnId !== turnId) {
          throw new Error('agent_protocol_invalid')
        }
        const item = record(params.item)
        if (item.type === 'agentMessage') {
          if (typeof item.text !== 'string') {
            throw new Error('agent_protocol_invalid')
          }
          final = item.text
        } else if (!['userMessage', 'reasoning'].includes(String(item.type))) {
          throw new Error('agent_tool_refused')
        }
      }
      if (message.method === 'turn/completed') {
        const params = record(message.params)
        const completed = record(params.turn)
        if (
          params.threadId !== threadId ||
          completed.id !== turnId ||
          completed.status !== 'completed' ||
          final === undefined
        ) {
          throw new Error('agent_turn_failed')
        }
        return decodeNativeResult(final)
      }
      if (message.method === 'error') {
        throw new Error('agent_turn_failed')
      }
    }
  } finally {
    await child.close()
  }
}
