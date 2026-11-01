import { strictJson } from '@invimport/contracts/json'
import type { CaptureRead } from './routes.ts'
import { fail } from './repository.ts'

/** Receives only a semantically constrained read closure, never a stock-send capability. */
export function captureRead(read: (operation: { kind: 'get_part' | 'get_location'; pk: string }) => Promise<Response>): CaptureRead {
  return async operation => {
    try {
      const response = await read({ kind: operation.model === 'part' ? 'get_part' : 'get_location', pk: operation.pk })
      if (!response.ok || !response.body) { await response.body?.cancel(); return fail('inventory_read_unavailable', 503) }
      const reader = response.body.getReader()
      const chunks: Uint8Array[] = []
      let size = 0
      let timedOut = false
      const timer = setTimeout(() => { timedOut = true; void reader.cancel() }, 5000)
      let complete = false
      try {
        for (;;) {
          const result = await reader.read()
          if (result.done) { complete = true; break }
          size += result.value.byteLength
          if (size > 65536) fail('inventory_response_invalid', 503)
          chunks.push(result.value)
        }
      } finally { clearTimeout(timer); if (!complete) await reader.cancel(); reader.releaseLock() }
      if (timedOut) fail('inventory_read_unavailable', 503)
      const value: unknown = strictJson(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks)))
      if (!value || typeof value !== 'object' || Array.isArray(value)) fail('inventory_response_invalid', 503)
      const row = value as Record<string, unknown>
      const pk = typeof row.pk === 'number' && Number.isSafeInteger(row.pk) ? String(row.pk) : row.pk
      if (pk !== operation.pk || typeof row.name !== 'string' || !row.name.length || row.name.length > 256) fail('inventory_response_invalid', 503)
      return { label: row.name }
    } catch { return fail('inventory_read_unavailable', 503) }
  }
}
