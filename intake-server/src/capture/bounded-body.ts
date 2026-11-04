export class BoundedBodyError extends Error {
  constructor(readonly reason: 'too_large' | 'timeout') {
    super(`bounded_body_${reason}`)
  }
}

/** Reads a target response body with a byte ceiling and a total deadline, cancelling on failure. */
export async function readBoundedBody(
  body: ReadableStream<Uint8Array>,
  maxBytes: number,
  deadlineMs: number,
): Promise<Buffer> {
  const reader = body.getReader()
  const chunks: Uint8Array[] = []
  let size = 0
  let timedOut = false
  let complete = false
  const timer = setTimeout(() => {
    timedOut = true
    void reader.cancel()
  }, deadlineMs)
  try {
    for (;;) {
      const result = await reader.read()
      if (result.done) {
        complete = true
        break
      }
      size += result.value.byteLength
      if (size > maxBytes) {
        throw new BoundedBodyError('too_large')
      }
      chunks.push(result.value)
    }
  } finally {
    clearTimeout(timer)
    if (!complete) {
      await reader.cancel()
    }
    reader.releaseLock()
  }
  if (timedOut) {
    throw new BoundedBodyError('timeout')
  }
  return Buffer.concat(chunks)
}
