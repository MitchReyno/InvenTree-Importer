// Entrypoint for one paired session turn. The operator transports opaque TLS bytes over
// stdio into the network-disabled guest. No host socket or host directory enters the container.
import { connect } from 'node:tls'
import { Duplex } from 'node:stream'
import { once } from 'node:events'
import { journalTurn, type TurnOutcome } from './journal.ts'
import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { validate } from '@invimport/contracts'
import type { ProcessingInputV6Dto } from '@invimport/contracts'
import { syntheticTurn, type SyntheticResult } from '../synthetic-turn.ts'
import { Frames, protocol } from './frames.ts'
import { SessionResumeUnavailable } from '../session-adapters.ts'
import { nativeTurn } from './native-turn.ts'
import { ResearchReapPendingError } from '../../research/errors.ts'
import { pairing } from './pair.ts'

const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/

async function main() {
  const socket = connect({
    ...(await pairing('/run/bench-pair')),
    servername: 'bench-coordinator',
    socket: Duplex.from({ readable: process.stdin, writable: process.stdout }),
  })
  try {
    await once(socket, 'secureConnect')
    const frames = new Frames(socket)
    await frames.send({ ready: protocol })
    const command = await frames.read()
    if (
      command.protocol !== protocol ||
      typeof command.attemptId !== 'string' ||
      !uuid.test(command.attemptId) ||
      typeof command.lineage !== 'string' ||
      !uuid.test(command.lineage) ||
      typeof command.turn !== 'string' ||
      !/^[1-9][0-9]{0,18}$/.test(command.turn)
    ) {
      throw new Error('invalid_turn')
    }
    validate('ProcessingInputV6', command.manifest)
    const manifest = command.manifest as ProcessingInputV6Dto
    if (!['synthetic-session/1', 'shared-vm-agent/1'].includes(manifest.profile_id)) {
      throw new Error('invalid_profile')
    }
    const identity = { lineage: command.lineage, attemptId: command.attemptId, turn: command.turn }
    const cwd = join('/home/node/sessions', identity.lineage)
    await mkdir(cwd, { recursive: true, mode: 0o700 })
    const path = join(cwd, command.attemptId + '-' + command.turn)
    const abort = new AbortController()
    socket.once('close', () => abort.abort())
    const execute = async (): Promise<TurnOutcome> => {
      if (manifest.profile_id === 'shared-vm-agent/1') {
        if (
          typeof command.text !== 'string' ||
          typeof command.instructions !== 'string' ||
          !Array.isArray(command.tools) ||
          command.tools.some((tool) => typeof tool !== 'string')
        ) {
          throw new Error('invalid_opening')
        }
        let pending = Promise.resolve()

        const request = (body: Record<string, unknown>) => {
          const result = pending.then(async () => {
            try {
              await frames.send(body)
              return await frames.read()
            } catch (error) {
              abort.abort()
              throw error
            }
          })
          pending = result.then(
            () => {},
            () => {},
          )
          return result
        }

        try {
          await nativeTurn(
            {
              manifest,
              cwd,
              signal: abort.signal,
              identity,
            },
            {
              text: command.text,
              instructions: command.instructions,
              tools: command.tools,
              resume: typeof command.resume === 'string' ? command.resume : undefined,
            },
            request,
          )
        } catch (error) {
          if (error instanceof ResearchReapPendingError) {
            throw error
          }
          if (error instanceof SessionResumeUnavailable) {
            return 'resume_unavailable'
          }
          const failure =
            error instanceof Error && error.message === 'agent_login_required'
              ? 'agent_login_required'
              : 'agent_turn_failed'
          return failure
        }
      } else {
        await frames.send({ started: true })
        if ((await frames.read()).ok !== true) {
          throw new Error('start_refused')
        }
        const resume = typeof command.resume === 'string' ? command.resume : undefined
        await syntheticTurn({ resume }, { cwd, manifest }, async (tool, args) => {
          await frames.send({ tool, args })
          const reply = await frames.read()
          if (!reply.result || typeof reply.result !== 'object') {
            throw new Error('invalid_tool_reply')
          }
          return reply.result as SyntheticResult
        })
      }
      return 'done'
    }
    const outcome = await journalTurn(path, command, execute, abort.signal)
    await frames.send(outcome === 'done' ? { done: true } : { failure: outcome })
    socket.end()
  } catch (error) {
    socket.destroy()
    throw error
  }
}

main().catch(() => {
  process.stderr.write('guest_turn_refused\n')
  process.exitCode = 1
})
