// Only the scoped fetch tool can opt its response into the larger image envelope.
export function evidenceRequest(body: unknown): { id: number | string } | undefined {
  if (typeof body !== 'string') return
  try {
    const call = JSON.parse(body)
    if (
      call?.jsonrpc === '2.0' &&
      call.method === 'tools/call' &&
      call.params?.name === 'fetch_evidence' &&
      (typeof call.id === 'number' || typeof call.id === 'string')
    )
      return { id: call.id }
  } catch {
    // Other messages retain normal MCP error handling.
  }
}
