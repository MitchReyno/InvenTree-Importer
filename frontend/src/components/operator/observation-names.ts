import type { CaptureSnapshotDto } from '@invimport/contracts'

type Observation = NonNullable<CaptureSnapshotDto['evidence_observations']>[number]

/**
 * A name per observation, from its markings, numbered when several read the same so each
 * control naming one stays distinct. Built over the whole batch so every list agrees.
 */
export function observationNames(observations: readonly Observation[]) {
  const counts = new Map<string, number>()
  const names = new Map<string, string>()
  for (const observation of observations) {
    const base = observation.readings.markings.join(' · ') || 'unread item'
    const count = (counts.get(base) ?? 0) + 1
    counts.set(base, count)
    names.set(observation.id, count > 1 ? `${base} (${count})` : base)
  }
  return names
}
