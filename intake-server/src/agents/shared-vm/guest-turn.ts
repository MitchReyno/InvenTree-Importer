// One paired session turn on an established TLS connection: greeting, command validation,
// the journaled turn and its terminal outcome. The entrypoint owns the transport.
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import type { TLSSocket } from 'node:tls'
import { validate } from '@invimport/contracts'
import type { ProcessingInputV6Dto } from '@invimport/contracts'
import { syntheticTurn, type SyntheticResult } from '#/agents/session/synthetic-turn.ts'
import { evidenceRequest } from './evidence-request.ts'
import { evidenceReplyLimit, Frames, protocol } from './frames.ts'
import { commandDigest, journalTurn, recordedOutcome, type TurnOutcome } from './journal.ts'
import { nativeTurnOutcome } from './native-outcome.ts'
import { nativeTurn } from './native-turn.ts'
import { isolatedToolTurn } from './tool-client.ts'
import { turnPolicy, writeTurnPolicy } from './turn-policy.ts'

const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/

export interface GuestTurnOptions {
  /** The subscription this peer serves, if any. */
  provider: 'claude' | 'codex' | undefined
  /** True for the paired supervisor of a tool worker. */
  isolated: boolean
  /** True when the VM-side launcher confirms worker removal through `reapPath`. */
  reapProof: boolean
  /** Parent of each lineage's private session directory and journal. */
  sessionsRoot: string
  /** Receipt the VM-side launcher reads to confirm worker removal. */
  reapPath: string
  /** The turn's egress policy file. */
  policyPath: string
  /** Replaces the provider runner; the default follows `isolated`. */
  runNative?: typeof nativeTurn
}

/** Serves exactly one turn or terminal probe on `socket`, then ends it. */
/** The provider's opening from a native turn command, or `invalid_opening`. */
function nativeOpening(command: Record<string, unknown>) {
  if (
    typeof command.text !== 'string' ||
    typeof command.instructions !== 'string' ||
    !Array.isArray(command.tools) ||
    command.tools.some((tool) => typeof tool !== 'string') ||
    // Absent means a fresh conversation; anything else present must name one to resume.
    (command.resume !== undefined &&
      (typeof command.resume !== 'string' || command.resume.length === 0))
  ) {
    throw new Error('invalid_opening')
  }
  return {
    text: command.text,
    instructions: command.instructions,
    tools: command.tools as string[],
    resume: command.resume as string | undefined,
  }
}

export async function serveGuestTurn(socket: TLSSocket, options: GuestTurnOptions) {
  const { provider, isolated, reapProof } = options
  const frames = new Frames(socket)
  await frames.send({
    reapProof,
    ready: protocol,
    terminalProbe: true,
    builtinTools: isolated,
    evidenceFiles: isolated,
    // This supervisor publishes each tool turn's egress policy from the command.
    turnPolicy: isolated,
    claudeSubscription: provider === 'claude',
    codexSubscription: provider === 'codex',
  })
  const packet = await frames.read()
  const probe = 'inspectTerminal' in packet
  if (
    probe &&
    (!packet.inspectTerminal ||
      typeof packet.inspectTerminal !== 'object' ||
      Array.isArray(packet.inspectTerminal))
  ) {
    throw new Error('invalid_probe')
  }
  const command = probe ? (packet.inspectTerminal as Record<string, unknown>) : packet
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
  if (
    isolated
      ? manifest.profile_id !== 'shared-vm-agent/3'
      : !['synthetic-session/1', 'shared-vm-agent/1'].includes(manifest.profile_id)
  ) {
    throw new Error('invalid_profile')
  }
  if (
    provider &&
    !(
      (manifest.profile_id === 'shared-vm-agent/1' ||
        manifest.profile_id === 'shared-vm-agent/3') &&
      manifest.agent?.provider === provider &&
      manifest.agent.authentication === 'subscription'
    )
  ) {
    throw new Error('wrong_guest_route')
  }
  // Validated before any effect; probes inspect a finished turn and change no policy.
  const policy = isolated && !probe ? turnPolicy(manifest, command.protected_hosts) : undefined
  const identity = { lineage: command.lineage, attemptId: command.attemptId, turn: command.turn }
  const cwd = join(options.sessionsRoot, identity.lineage)
  const path = join(cwd, command.attemptId + '-' + command.turn)
  if (probe) {
    if (packet.requireReap === true) {
      if (!reapProof) {
        throw new Error('reap_proof_unavailable')
      }
      const digest = commandDigest(command)
      const deadline = Date.now() + 12000
      // A second ready relay can receive this probe before the original relay finishes cleanup.
      while ((await readFile(path + '.reaped', 'utf8').catch(() => undefined)) !== digest + '\n') {
        if (Date.now() >= deadline || socket.destroyed) {
          throw new Error('unconfirmed_worker_removal')
        }
        await delay(100)
      }
      await frames.send({ terminalOutcome: 'worker_removed' })
      socket.end()
      return
    }
    const outcome = await recordedOutcome(path, command)
    await frames.send({ terminalOutcome: outcome })
    socket.end()
    return
  }
  // Decoded before the session directory, reap receipt or journal exists.
  const opening = manifest.profile_id === 'synthetic-session/1' ? undefined : nativeOpening(command)
  await mkdir(cwd, { recursive: true, mode: 0o700 })
  const abort = new AbortController()
  socket.once('close', () => abort.abort())

  const execute = async (): Promise<TurnOutcome> => {
    if (reapProof) {
      // This directory is visible only to the paired supervisor and the VM-side launcher.
      await writeFile(
        options.reapPath,
        commandDigest(command) +
          ' ' +
          identity.lineage +
          '/' +
          identity.attemptId +
          '-' +
          identity.turn +
          '\n',
        { flag: 'wx', mode: 0o600 },
      )
    }
    if (opening) {
      let pending = Promise.resolve()

      const request = (body: Record<string, unknown>) => {
        const result = pending.then(async () => {
          try {
            await frames.send(body)
            return await frames.read(
              isolated && evidenceRequest(body.mcp) ? evidenceReplyLimit : undefined,
            )
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

      const outcome = await nativeTurnOutcome({
        // The egress proxy allows only provider hosts until this file exists.
        publishPolicy: policy ? () => writeTurnPolicy(options.policyPath, policy) : undefined,
        run: async () => {
          const runNative = options.runNative ?? (isolated ? isolatedToolTurn : nativeTurn)
          await runNative(
            {
              manifest,
              cwd,
              signal: abort.signal,
              identity,
            },
            opening,
            request,
          )
        },
      })
      if (outcome !== 'done') {
        return outcome
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
}
