/** Session tools whose successful reply carries one image for the agent to look at. */
const IMAGE_TOOLS = new Set(['inspect_region', 'preview_images', 'match_logo'])

/**
 * The kind of an image-bearing tool call. Only a `fetch` image can grant a citation, once its
 * release is confirmed; a `preview` (an `ask` preview) and a `tool_image` are only for the agent
 * to check and grant nothing.
 */
export type EvidenceRequestKind = 'fetch' | 'preview' | 'tool_image'

/** Image-bearing tool calls whose responses get the larger evidence envelope. */
export function evidenceRequest(
  body: unknown,
): { id: number | string; kind: EvidenceRequestKind } | undefined {
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
    const name = call.params?.name
    if (name === 'fetch_evidence') {
      return { id: call.id, kind: 'fetch' }
    }
    if (name === 'ask' && call.params?.arguments?.preview === true) {
      return { id: call.id, kind: 'preview' }
    }
    if (typeof name === 'string' && IMAGE_TOOLS.has(name)) {
      return { id: call.id, kind: 'tool_image' }
    }
  } catch {
    // Other messages retain normal MCP error handling.
  }
}
