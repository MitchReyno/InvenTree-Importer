import {
  PositivePk,
  validate,
  type InventoryMappingDto,
  type InventoryModelDto,
} from '@invimport/contracts'
import type { ReadOperation } from '../inventory/transport.ts'
import { strictJson } from '@invimport/contracts/json'
import { approvedTagsPresent } from '../inventory/tags.ts'
import type { CaptureRead, CaptureReadOperation } from './routes.ts'
import { fail } from './repository.ts'

/** Receives only a semantically constrained read closure, never a stock-send capability. */
export function captureRead(read: (operation: ReadOperation) => Promise<Response>): CaptureRead {
  return async (operation) => {
    try {
      const response = await read({
        kind:
          operation.model === 'part' && operation.includeTags
            ? 'get_tagged_part'
            : readKind(operation.model),
        pk: operation.pk,
      })
      if (!response.ok || !response.body) {
        await response.body?.cancel()
        return fail('inventory_read_unavailable', 503)
      }
      const reader = response.body.getReader()
      const chunks: Uint8Array[] = []
      let size = 0
      let timedOut = false
      const timer = setTimeout(() => {
        timedOut = true
        void reader.cancel()
      }, 5000)
      let complete = false
      try {
        for (;;) {
          const result = await reader.read()
          if (result.done) {
            complete = true
            break
          }
          size += result.value.byteLength
          if (size > 65536) {
            fail('inventory_response_invalid', 503)
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
        fail('inventory_read_unavailable', 503)
      }
      return decodeInventoryObservation(operation, Buffer.concat(chunks))
    } catch {
      return fail('inventory_read_unavailable', 503)
    }
  }
}

export function readKind(model: InventoryModelDto): ReadOperation['kind'] {
  const kinds = {
    part: 'get_part',
    location: 'get_location',
    category: 'get_category',
    parameter_template: 'get_parameter_template',
    category_parameter: 'get_category_parameter',
    company: 'get_company',
  } as const
  return kinds[model]
}

function readMapping(
  model: InventoryModelDto,
  row: Record<string, unknown>,
): InventoryMappingDto | null {
  let value: unknown
  if (model === 'category') {
    value = { kind: model }
  } else if (model === 'parameter_template') {
    value = { kind: model, model_type: row.model_type, enabled: row.enabled }
  } else if (model === 'category_parameter') {
    value = { kind: model, category_id: exactPk(row.category), template_id: exactPk(row.template) }
  } else if (model === 'company') {
    value = { kind: model, manufacturer: row.is_manufacturer, supplier: row.is_supplier }
  } else {
    return null
  }
  validate('InventoryMapping', value)
  return value as InventoryMappingDto
}

function exactPk(value: unknown) {
  return typeof value === 'number' && Number.isSafeInteger(value) ? String(value) : value
}

export function decodeInventoryObservation(operation: CaptureReadOperation, bytes: Buffer) {
  const value: unknown = strictJson(new TextDecoder('utf-8', { fatal: true }).decode(bytes))
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    fail('inventory_response_invalid', 503)
  }
  const row = value as Record<string, unknown>
  const pk = typeof row.pk === 'number' && Number.isSafeInteger(row.pk) ? String(row.pk) : row.pk
  const label =
    operation.model === 'category_parameter'
      ? `Category ${exactPk(row.category)} / template ${exactPk(row.template)}`
      : row.name
  if (pk !== operation.pk || typeof label !== 'string' || !label.length || label.length > 256) {
    fail('inventory_response_invalid', 503)
  }
  const mapping = readMapping(operation.model, row)
  let partIdentity: { category_id: string; tags?: string[] } | undefined
  if (operation.model === 'part' && Object.hasOwn(row, 'category')) {
    const category = exactPk(row.category)
    if (
      typeof category !== 'string' ||
      !new RegExp(PositivePk.pattern!).test(category) ||
      BigInt(category) > 9223372036854775807n
    ) {
      fail('inventory_response_invalid', 503)
    }
    if (operation.includeTags) {
      if (!approvedTagsPresent([], row.tags)) {
        fail('inventory_response_invalid', 503)
      }
      partIdentity = { category_id: category, tags: row.tags as string[] }
    } else {
      partIdentity = { category_id: category }
    }
  }
  return { label, ...(mapping ? { mapping } : {}), ...(partIdentity ? { partIdentity } : {}) }
}
