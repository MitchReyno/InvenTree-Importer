import { evidenceRequest } from './evidence-request.ts'
// Only the guest tool container runs this entrypoint. It has no pairing or journal mount.
import { createServer } from 'node:net'
import { once } from 'node:events'
import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import type { ProcessingInputV6Dto } from '@invimport/contracts'
import { validate } from '@invimport/contracts'
import { NativeSessionError } from '../failure-model.ts'
import { ResearchReapPendingError } from '../../research/errors.ts'
import { evidenceReplyLimit, Frames } from './frames.ts'
import { providerProxy } from './provider-proxy.ts'
import { nativeTurn } from './native-turn.ts'
import type { SessionDriverContext } from '../session/session-runner.ts'
import type { SessionTurn } from '../session/session-adapters.ts'
import { SessionResumeUnavailable } from '../session/session-adapters.ts'

const provider = process.env.INTAKE_VM_CODEX_SUBSCRIPTION === '1' ? 'codex' : 'claude'
const proxy = await providerProxy(provider)
const server = createServer()
server.listen('/run/turn/worker.sock')
const [socket] = await once(server, 'connection')
server.close()
const frames = new Frames(socket)
const abort = new AbortController()
socket.once('close', () => abort.abort())
try {
  const message = await frames.read()
  validate('ProcessingInputV6', message.manifest)
  const manifest = message.manifest as ProcessingInputV6Dto
  const identity = message.identity as SessionDriverContext['identity']
  if (
    manifest.profile_id !== 'shared-vm-agent/2' ||
    manifest.agent?.provider !== provider ||
    manifest.agent.authentication !== 'subscription' ||
    !/^[0-9a-f-]{36}$/.test(identity.lineage)
  ) {
    throw new Error('invalid_tool_worker_route')
  }
  const cwd = join('/home/node/sessions', identity.lineage)
  await mkdir(cwd, { recursive: true, mode: 0o700 })
  let pending = Promise.resolve()

  const request = (body: Record<string, unknown>) => {
    const result = pending.then(async () => {
      await frames.send({ request: body })
      return frames.read(evidenceRequest(body.mcp) ? evidenceReplyLimit : undefined)
    })
    pending = result.then(
      () => {},
      () => {},
    )
    return result
  }

  await nativeTurn(
    { manifest, identity, cwd, signal: abort.signal },
    message.opening as SessionTurn,
    request,
    true,
  )
  await frames.send({ outcome: 'done' })
} catch (error) {
  if (!(error instanceof ResearchReapPendingError)) {
    let outcome = 'agent_turn_failed'
    if (error instanceof SessionResumeUnavailable) {
      outcome = 'resume_unavailable'
    }
    if (error instanceof NativeSessionError && error.message === 'agent_login_required') {
      outcome = 'agent_login_required'
    }
    await frames.send({ outcome }).catch(() => {})
  }
} finally {
  socket.end()
  proxy.close()
}
