const MIB = 1024 * 1024

/**
 * What the agent VM keeps running besides turns: Docker and containerd, each provider's egress and
 * management containers, Claude's catalogue container and the kernel's own use.
 */
export const ALWAYS_ON_MIB = 768

/** One tool turn's container ceilings: 640 MiB worker, 256 MiB supervisor and 64 MiB tunnel. */
export const TURN_MIB = 960

/** The range a guest's memory report must fall in to be believed. */
const MIN_REPORTED_BYTES = 256 * MIB
const MAX_REPORTED_BYTES = 1024 * 1024 * MIB

/** A memory report from a guest greeting, or undefined when it isn't one. */
export function reportedMemory(value: unknown) {
  if (
    typeof value !== 'number' ||
    !Number.isSafeInteger(value) ||
    value < MIN_REPORTED_BYTES ||
    value > MAX_REPORTED_BYTES
  ) {
    return undefined
  }
  return value
}

/**
 * How many tool turns a VM with `memoryBytes` holds at their ceilings beside its always-on
 * services: at least one, so a small VM still runs turns one at a time. Unknown memory holds one.
 */
export function vmTurnCapacity(memoryBytes: number | undefined) {
  if (memoryBytes === undefined) {
    return 1
  }
  const forTurnsMib = memoryBytes / MIB - ALWAYS_ON_MIB
  return Math.max(1, Math.floor(forTurnsMib / TURN_MIB))
}
