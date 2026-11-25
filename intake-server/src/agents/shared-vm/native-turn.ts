import { stat } from 'node:fs/promises'
import { NativeSessionError } from '#/agents/failure-model.ts'
import { nativeAgentHost } from '#/agents/environment.ts'
import { nativeDriver, type SessionDriverContext } from '#/agents/session/session-runner.ts'
import type { SessionTurn } from '#/agents/session/session-adapters.ts'
import { readClaudeToken } from './claude-credential.ts'
import { startMcpProxy } from './mcp-proxy.ts'
import type { EvidenceDelivery } from './stage-evidence.ts'

/** Only the current provider's loopback MCP endpoint is exposed inside the guest. */
export async function nativeTurn(
  context: SessionDriverContext,
  opening: Pick<SessionTurn, 'resume' | 'text' | 'instructions' | 'tools'>,
  request: (body: Record<string, unknown>) => Promise<Record<string, unknown>>,
  guestTools = false,
  delivery: EvidenceDelivery = 'file',
) {
  let delivered: bigint | undefined
  let version: string | undefined
  const selection = context.manifest.agent
  if (!selection) {
    throw new Error('missing_agent_selection')
  }
  const guestCodexSubscription =
    process.env.INTAKE_VM_CODEX_SUBSCRIPTION === '1' &&
    selection.provider === 'codex' &&
    selection.authentication === 'subscription'
  let guestClaudeToken
  if (selection.authentication === 'subscription') {
    if (selection.provider === 'claude' && process.env.INTAKE_VM_CLAUDE_SUBSCRIPTION === '1') {
      guestClaudeToken = readClaudeToken('/run/claude-store')
    }
    if (
      !guestClaudeToken &&
      !(
        guestCodexSubscription &&
        (await stat('/run/codex-state/account').then(
          (s) => s.isDirectory(),
          () => false,
        ))
      )
    ) {
      throw new NativeSessionError('agent_login_required')
    }
  }
  const proxy = await startMcpProxy(request, guestTools, delivery)
  try {
    const host = nativeAgentHost({
      ...process.env,
      INTAKE_AGENT_STATE_ROOT: '/home/node/sessions/provider',
    })
    host.guestTools = guestTools
    host.guestCodexSubscription = guestCodexSubscription
    host.guestClaudeToken = guestClaudeToken
    await nativeDriver(host, selection)(
      {
        ...opening,
        capability: proxy.capability,
        toolUrl: proxy.toolUrl,
        nextDelivery: async () => {
          const reply = await request({ nextDelivery: true })
          return typeof reply.text === 'string' && typeof reply.seq === 'string'
            ? { text: reply.text, seq: BigInt(reply.seq) }
            : undefined
        },
        onDelivered: (seq) => {
          delivered = seq
        },
        onStarted: async (details) => {
          await request({ provider: details })
        },
        onEffortSent: async (effort) => {
          await request({ sentEffort: effort })
        },
        onCliVersion: (value) => {
          version = value
        },
      },
      context,
    )
    await proxy.flush()
    await request({ progress: true, version, delivered: delivered?.toString() })
  } finally {
    await proxy.close()
  }
}
