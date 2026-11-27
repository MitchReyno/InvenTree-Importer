/** Browser storage as the device preferences use it; it may be missing. */
export type PreferenceStorage = Pick<Storage, 'getItem' | 'setItem'>

function isAllowed<T extends string>(value: unknown, allowed: readonly T[]): value is T {
  return allowed.some((option) => option === value)
}

/**
 * Reads a stored preference, or `fallback` when the value is unknown. Storage can be missing
 * or throw (private windows, blocked site data).
 */
export function readPreference<T extends string>(
  storage: () => PreferenceStorage | undefined,
  key: string,
  allowed: readonly T[],
  fallback: T,
): T {
  try {
    const stored = storage()?.getItem(key)

    return isAllowed(stored, allowed) ? stored : fallback
  } catch {
    return fallback
  }
}

/** Stores a preference; when storage is unavailable the choice still applies for the session. */
export function writePreference(
  storage: () => PreferenceStorage | undefined,
  key: string,
  value: string,
): void {
  try {
    storage()?.setItem(key, value)
  } catch {
    // Kept for this session only.
  }
}
