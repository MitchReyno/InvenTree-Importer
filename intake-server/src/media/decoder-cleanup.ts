import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { setTimeout as delay } from 'node:timers/promises'

const execute = promisify(execFile)
export const DECODER_LABEL = 'bench.intake.decoder-owner='

export async function decoderEngine(args: string[]) {
  const result = await execute('docker', args, {
    env: { PATH: process.env.PATH },
    timeout: 5000,
    killSignal: 'SIGKILL',
    maxBuffer: 8192,
  })
  return result.stdout.trim()
}

/** A lost Docker reply leaves capacity occupied until the engine confirms the named child is absent. */
export async function reapDecoder(name: string, run = decoderEngine, retry = () => delay(1000)) {
  for (;;) {
    try {
      await run(['rm', '--force', name])
      return
    } catch {
      try {
        if (
          !(await run(['container', 'ls', '--all', '--quiet', '--filter', 'name=^/' + name + '$']))
        ) {
          return
        }
      } catch {
        // An unreachable engine cannot acknowledge cleanup.
      }
    }
    await retry()
  }
}

/** Fence pending starts by removing the old owner's created and running containers by immutable ID. */
export async function retireOwnerDecoders(owner: string, run = decoderEngine) {
  const children = await run([
    'container',
    'ls',
    '--all',
    '--quiet',
    '--no-trunc',
    '--filter',
    'label=' + DECODER_LABEL + owner,
  ])
  for (const id of children.split(/\s+/).filter(Boolean)) {
    if (!/^[a-f0-9]{64}$/.test(id)) {
      throw new Error('invalid_decoder_container_id')
    }
    try {
      await run(['rm', '--force', id])
    } catch {
      if (await run(['container', 'ls', '--all', '--quiet', '--filter', 'id=' + id])) {
        throw new Error('decoder_owner_cleanup_unconfirmed')
      }
    }
  }
}
