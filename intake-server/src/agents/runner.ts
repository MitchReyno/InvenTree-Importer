import { monitorNativeAttempt } from './monitor.ts'
import { join } from 'node:path'
import type { Pool } from 'pg'
import { validate, type ProcessingEnvelopeV4Dto } from '@invimport/contracts'
import type { BlobStore } from '#/media/blob-store.ts'
import type { ProcessingConfig } from '#/processing/attempts.ts'
import type { RestrictedResearchRunner } from '#/processing/runner.ts'
import { ResearchReapPendingError } from '#/research/errors.ts'
import { nativeInstructions, nativeProfileId } from './policy.ts'
import { agentEnvironment, privateDirectory, type NativeAgentHost } from './environment.ts'
import { stageNativePrompt, verifyInspectedSources } from './prompt.ts'
import { runCodex } from './codex.ts'
import { runClaude } from './claude.ts'
import { recordSessionProgress } from './session/sessions.ts'

/** The coordinator retains DB/channel authority. Children receive staged evidence and one selected auth route only. */
export function nativeAgentRunner(
  pool: Pool,
  config: ProcessingConfig,
  host: NativeAgentHost,
  store?: BlobStore,
  shutdown?: AbortSignal,
): RestrictedResearchRunner {
  return {
    qualification: 'native_unverified',
    profileId: nativeProfileId,
    async run(input, emit) {
      validate('ProcessingInputV4', input.manifest)
      validate('ProcessingCommandV4', input.payload)
      const manifest = input.manifest
      if (
        manifest.schema_version !== 'bench-intake-input/4' ||
        input.instructions !== nativeInstructions
      ) {
        throw new Error('agent_input_invalid')
      }
      const lifetime = monitorNativeAttempt(pool, input.payload.attempt_id, shutdown)
      const controller = lifetime.controller
      let sequence = 0

      const message = async (
        content:
          | Pick<Extract<ProcessingEnvelopeV4Dto, { kind: 'proposal' }>, 'kind' | 'payload'>
          | Pick<Extract<ProcessingEnvelopeV4Dto, { kind: 'question' }>, 'kind' | 'payload'>
          | Pick<Extract<ProcessingEnvelopeV4Dto, { kind: 'terminal' }>, 'kind' | 'payload'>,
      ) => {
        const envelope: ProcessingEnvelopeV4Dto = {
          schema_version: 'bench-intake-runner/4',
          job_id: input.payload.job_id,
          attempt_id: input.payload.attempt_id,
          command_id: input.payload.command_id,
          input_sha256: input.payload.input_sha256,
          profile_id: nativeProfileId,
          handler_version: 'processing/4',
          sequence: String(++sequence),
          ...content,
        }
        await emit(envelope)
      }

      try {
        await recordSessionProgress(pool, config, input.payload.attempt_id, {
          progress: 'starting',
        })
        const cwd = await privateDirectory(
          join(host.stateRoot, 'sessions', input.payload.attempt_id),
        )
        const env = agentEnvironment(host, manifest.agent, cwd)
        if (manifest.agent.provider === 'codex') {
          await privateDirectory(env.CODEX_HOME!)
        }
        const prompt = await stageNativePrompt(pool, config, store, input, manifest)
        const run = manifest.agent.provider === 'codex' ? runCodex : runClaude
        const result = await run(
          host,
          manifest.agent,
          prompt,
          cwd,
          env,
          controller.signal,
          (progress) => recordSessionProgress(pool, config, input.payload.attempt_id, progress),
        )
        controller.signal.throwIfAborted()
        // The native adapter returns only after confirmed child/group reap.
        await recordSessionProgress(pool, config, input.payload.attempt_id, { progress: 'settled' })
        if (result.proposal) {
          verifyInspectedSources(prompt, result.proposal)
          await message({ kind: 'proposal', payload: result.proposal })
          await message({ kind: 'terminal', payload: { state: 'ready' } })
        } else if (result.question) {
          await message({ kind: 'question', payload: result.question })
        }
      } catch (error) {
        if (error instanceof ResearchReapPendingError) {
          throw error
        }
        await recordSessionProgress(pool, config, input.payload.attempt_id, { progress: 'settled' })
        const login = error instanceof Error && error.message === 'agent_login_required'
        let state: 'interrupted' | 'waiting_for_login' | 'failed' = 'failed'
        if (controller.signal.aborted) {
          state = 'interrupted'
        } else if (login) {
          state = 'waiting_for_login'
        }
        await message({ kind: 'terminal', payload: { state } })
      } finally {
        await lifetime.stop()
      }
    },
  }
}
