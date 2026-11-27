import { assertResearchActive, ResearchError } from './errors.ts'

/** Stop waiting even when a host resolver cannot cancel its underlying lookup. */
export async function awaitResearchResult<T>(
  operation: Promise<T>,
  signal: AbortSignal,
): Promise<T> {
  assertResearchActive(signal)
  return new Promise<T>((resolve, reject) => {
    function aborted() {
      reject(new ResearchError('research_cancelled'))
    }

    signal.addEventListener('abort', aborted, { once: true })
    operation.then(
      (value) => {
        signal.removeEventListener('abort', aborted)
        resolve(value)
      },
      (error) => {
        signal.removeEventListener('abort', aborted)
        reject(error)
      },
    )
    if (signal.aborted) {
      aborted()
    }
  })
}
