/**
 * Image-bearing tool calls whose responses get the larger evidence envelope: `fetch_evidence`,
 * whose image grants a citation once its release is confirmed, and an `ask` preview, whose images
 * are only for the agent to check and grant nothing.
 */
export function evidenceRequest(
  body: unknown,
): { id: number | string; kind: 'fetch' | 'preview' } | undefined {
  if (typeof body !== 'string') {
    return
  }
  try {
    const call = JSON.parse(body)
    if (
      call?.jsonrpc !== '2.0' ||
      call.method !== 'tools/call' ||
      (typeof call.id !== 'number' && typeof call.id !== 'string')
    ) {
      return
    }
    if (call.params?.name === 'fetch_evidence') {
      return { id: call.id, kind: 'fetch' }
    }
    if (call.params?.name === 'ask' && call.params?.arguments?.preview === true) {
      return { id: call.id, kind: 'preview' }
    }
  } catch {
    // Other messages retain normal MCP error handling.
  }
}
