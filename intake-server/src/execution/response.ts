import { strictJson } from '@invimport/contracts/json'
import { pk, type StockOperation } from './plan.ts'

export async function inventoryBody(
  response: Response,
  maxBytes = 65536,
  timeoutMs = 5000,
): Promise<Buffer> {
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 5000) {
    throw new Error('inventory_body_policy_invalid')
  }
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 0 || maxBytes > 20 * 1024 * 1024 + 8192) {
    throw new Error('inventory_body_policy_invalid')
  }
  const reader = response.body?.getReader()
  if (!reader) {
    return Buffer.alloc(0)
  }
  const chunks: Uint8Array[] = []
  let length = 0
  let timedOut = false
  const timer = setTimeout(() => {
    timedOut = true
    void reader.cancel().catch(() => undefined)
  }, timeoutMs)
  try {
    for (;;) {
      const next = await reader.read()
      if (timedOut) {
        throw new Error('inventory_body_timeout')
      }
      if (next.done) {
        break
      }
      length += next.value.byteLength
      if (length > maxBytes) {
        throw new Error('inventory_body_limit')
      }
      chunks.push(next.value)
    }
    return Buffer.concat(chunks)
  } finally {
    clearTimeout(timer)
    await reader.cancel().catch(() => undefined)
  }
}

export function responseObject(bytes: Buffer): Record<string, unknown> {
  const value = strictJson(new TextDecoder('utf-8', { fatal: true }).decode(bytes))
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('inventory_response_invalid')
  }
  return value as Record<string, unknown>
}

export function responsePk(value: unknown): string {
  const result = typeof value === 'number' && Number.isSafeInteger(value) ? String(value) : value
  pk(result)
  return result
}

export function stockMatches(value: Record<string, unknown>, operation: StockOperation): boolean {
  return (
    responsePk(value.part) === operation.part &&
    (value.location === null ? null : responsePk(value.location)) === operation.location &&
    value.quantity === operation.quantity &&
    value.barcode === operation.barcode
  )
}
