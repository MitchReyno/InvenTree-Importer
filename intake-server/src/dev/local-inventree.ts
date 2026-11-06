import { join } from 'node:path'
import { readPrivateFile, stateDirectory } from './pg-identity.ts'

// Erasable TypeScript only: the dev supervisor loads this module through Node's type stripping.

/** The file `pnpm inventree:dev up` keeps for the local InvenTree instance. */
export const LOCAL_STATE_FILE = 'inventree-dev.json'
const TOKEN = /^inv-[A-Za-z0-9]{20,80}-\d{8}$/

/** The instance ID that scopes app state, and the read-only token the app reads with. */
export async function readLocalInventree(
  env: Record<string, string | undefined> = process.env,
): Promise<{ instanceId: string; readToken: string }> {
  const text = await readPrivateFile(join(stateDirectory(env), LOCAL_STATE_FILE))
  if (text === undefined) {
    throw new Error('local_inventree_not_ready_run_up')
  }
  let state: { instance_id?: unknown; tokens?: { reader?: unknown } | null }
  try {
    state = JSON.parse(text)
  } catch {
    throw new Error('invalid_local_inventree_state')
  }
  const instanceId = state.instance_id
  const readToken = state.tokens?.reader
  if (typeof instanceId !== 'string' || !/^[a-f0-9]{32}$/.test(instanceId)) {
    throw new Error('invalid_local_inventree_state')
  }
  if (typeof readToken !== 'string' || !TOKEN.test(readToken)) {
    throw new Error('local_inventree_not_ready_run_up')
  }
  return { instanceId, readToken }
}
