/** Match the fixture server's request bound, without retrying uncertain commands. */
const FIXTURE_HTTP_TIMEOUT_MS = 10000

type RequestPhase = 'request' | 'response_body'

export class ProcessingFixtureHttpError extends Error {
  constructor(
    readonly method: string,
    readonly path: string,
    readonly phase: RequestPhase,
    cause: unknown,
  ) {
    super(`processing_fixture_http_failed:${method}:${path}:${phase}`, { cause })
    this.name = 'ProcessingFixtureHttpError'
  }
}

/** JSON is wire data; consumers still validate domain DTOs at their owning boundary. */
export async function requestProcessingFixtureJson(
  origin: string,
  path: string,
  init: RequestInit = {},
  timeoutMs = FIXTURE_HTTP_TIMEOUT_MS,
) {
  const method = init.method ?? 'GET'
  let phase: RequestPhase = 'request'
  try {
    const response = await fetch(`${origin}/api/v1${path}`, {
      ...init,
      signal: AbortSignal.timeout(timeoutMs),
    })
    phase = 'response_body'
    const value = await response.json()
    return { status: response.status, value }
  } catch (cause) {
    // Do not log headers, payloads, private origins or credentials; preserve the original cause.
    throw new ProcessingFixtureHttpError(method, path, phase, cause)
  }
}
