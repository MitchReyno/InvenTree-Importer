/**
 * Adapts an async handler for an event API that ignores what its listener returns. A rejection
 * the handler did not catch goes to `onEscape` with the same arguments, instead of ending the
 * process as an unhandled rejection.
 */
export function settled<A extends unknown[]>(
  handler: (...args: A) => Promise<void>,
  onEscape: (error: unknown, ...args: A) => void,
): (...args: A) => void {
  return (...args) => {
    handler(...args).catch((error: unknown) => onEscape(error, ...args))
  }
}
