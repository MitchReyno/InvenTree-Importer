import { evidenceRequest } from './evidence-request.ts'
import { createServer } from 'node:http'
import { once } from 'node:events'
import { mkdtemp, rm, stat } from 'node:fs/promises'
import { randomBytes } from 'node:crypto'
import { NativeSessionError } from '../failure-model.ts'
import { nativeAgentHost } from '../environment.ts'
import { nativeDriver, type SessionDriverContext } from '../session-runner.ts'
import type { SessionTurn } from '../session-adapters.ts'
import { readClaudeToken } from './claude-credential.ts'
import { stageEvidence } from './stage-evidence.ts'
import { readBounded } from './frames.ts'

/** Only the current provider's loopback MCP endpoint is exposed inside the guest. */
export async function nativeTurn(
  context: SessionDriverContext,
  opening: Pick<SessionTurn, 'resume' | 'text' | 'instructions' | 'tools'>,
  request: (body: Record<string, unknown>) => Promise<Record<string, unknown>>,
  guestTools = false,
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
  const capability = randomBytes(32).toString('hex')
  let evidenceDir: Promise<string> | undefined
  const proxy = createServer(async (req, res) => {
    try {
      if (
        req.url !== '/mcp' ||
        req.method !== 'POST' ||
        req.headers.authorization !== 'Bearer ' + capability
      ) {
        res.writeHead(403).end()
        return
      }
      const body = await readBounded(req)
      const reply = await request({ mcp: body })
      if (typeof reply.body !== 'string' || typeof reply.status !== 'number') {
        throw new Error('invalid_reply')
      }
      const evidence = guestTools && reply.status === 200 && evidenceRequest(body)
      const responseBody = evidence
        ? await stageEvidence(
            evidence.id,
            reply.body,
            () => (evidenceDir ??= mkdtemp('/tmp/bench-evidence-')),
          )
        : reply.body
      res.writeHead(reply.status, { 'content-type': 'application/json' }).end(responseBody)
    } catch {
      res.writeHead(502).end()
    }
  })
  proxy.listen(0, '127.0.0.1')
  await once(proxy, 'listening')
  try {
    const address = proxy.address()
    if (!address || typeof address === 'string') {
      throw new Error('missing_address')
    }
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
        capability,
        toolUrl: 'http://127.0.0.1:' + address.port + '/mcp',
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
        onCliVersion: (value) => {
          version = value
        },
      },
      context,
    )
    await request({ progress: true, version, delivered: delivered?.toString() })
  } finally {
    proxy.closeAllConnections()
    proxy.close()
    if (evidenceDir) await rm(await evidenceDir, { recursive: true, force: true })
  }
}
