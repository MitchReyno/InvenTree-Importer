/**
 * The newest of a confirmed answer and the settings already known, by revision. A late reload
 * or save answer is never adopted over newer settings the page already holds.
 */
export function newestRevision<T extends { revision: string }>(
  confirmed: T,
  ...known: (T | undefined)[]
): T {
  return known.reduce<T>(
    (best, settings) =>
      settings && BigInt(settings.revision) > BigInt(best.revision) ? settings : best,
    confirmed,
  )
}
