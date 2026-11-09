import { createHash } from 'node:crypto'
import { open, readFile } from 'node:fs/promises'
import { dirname } from 'node:path'

export type TurnOutcome =
  'done' | 'agent_login_required' | 'agent_turn_failed' | 'resume_unavailable'

// A probe may observe completed work but must never create a journal or run a turn.
export async function recordedOutcome(
  path: string,
  command: Record<string, unknown>,
): Promise<TurnOutcome> {
  const digest = commandDigest(command)
  const recorded = await readFile(path, 'utf8')
  for (const outcome of [
    'done',
    'agent_login_required',
    'agent_turn_failed',
    'resume_unavailable',
  ] as const) {
    if (recorded === digest + '\n' + outcome + '\n') {
      return outcome
    }
  }
  throw new Error('turn_requires_reconciliation')
}

export function commandDigest(command: Record<string, unknown>) {
  return createHash('sha256').update(JSON.stringify(command)).digest('hex')
}

/** The exclusive record precedes any provider effect. Partial records require reconciliation. */
export async function journalTurn(
  path: string,
  command: Record<string, unknown>,
  execute: () => Promise<TurnOutcome>,
  signal?: AbortSignal,
): Promise<TurnOutcome> {
  const digest = commandDigest(command)
  const file = await open(path, 'wx', 0o600).catch((error) => {
    if (error.code !== 'EEXIST') {
      throw error
    }
    return undefined
  })
  if (!file) {
    return recordedOutcome(path, command)
  }
  try {
    await file.writeFile(digest + '\n')
    await file.sync()
    const directory = await open(dirname(path), 'r')
    try {
      await directory.sync()
    } finally {
      await directory.close()
    }
    const outcome = await execute()
    signal?.throwIfAborted()
    await file.writeFile(outcome + '\n')
    await file.sync()
    return outcome
  } finally {
    await file.close()
  }
}
