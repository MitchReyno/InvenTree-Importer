import { createHash } from 'node:crypto'
import { open, readFile } from 'node:fs/promises'
import { dirname } from 'node:path'

/** Tool-policy refusals keep their own codes through the bridge, so the operator sees why. */
export const REFUSAL_OUTCOMES = ['agent_tool_refused', 'agent_policy_refused'] as const

const TURN_OUTCOMES = [
  'done',
  'agent_login_required',
  'agent_turn_failed',
  'resume_unavailable',
  ...REFUSAL_OUTCOMES,
] as const

export type TurnOutcome = (typeof TURN_OUTCOMES)[number]

/** A refusal code the bridge carries as itself, or undefined for any other value. */
export function refusalOutcome(value: unknown): (typeof REFUSAL_OUTCOMES)[number] | undefined {
  return REFUSAL_OUTCOMES.find((outcome) => outcome === value)
}

// A probe may observe completed work but must never create a journal or run a turn.
export async function recordedOutcome(
  path: string,
  command: Record<string, unknown>,
): Promise<TurnOutcome> {
  const digest = commandDigest(command)
  const recorded = await readFile(path, 'utf8')
  for (const outcome of TURN_OUTCOMES) {
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
