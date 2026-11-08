import { FormatRegistry, Type } from '@sinclair/typebox'

export function validInt64(value: string) {
  return /^(0|[1-9][0-9]{0,18})(?![\s\S])/.test(value) && BigInt(value) <= 9223372036854775807n
}

// Interpreted media validation and compiled HTTP validation share exact integer limits.
FormatRegistry.Set('int64', validInt64)

const end = '(?![\\s\\S])'
export const Id = Type.String({
  pattern: '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}' + end,
})
export const Revision = Type.String({ pattern: '^[1-9][0-9]{0,18}' + end, format: 'int64' })
export const CursorSequence = Type.String({
  pattern: '^(0|[1-9][0-9]{0,18})' + end,
  format: 'int64',
})
export const Digest = Type.String({ pattern: '^[0-9a-f]{64}' + end })
export const PositivePk = Type.String({ pattern: '^[1-9][0-9]{0,18}' + end, format: 'int64' })
export const Quantity = Type.String({
  pattern: '^(?=.*[1-9])(0|[1-9][0-9]{0,12})(\\.[0-9]{0,5}[1-9])?' + end,
})

/** An ISO 8601 instant with an explicit offset, as the server writes them. */
export const IsoTime = Type.String({
  maxLength: 40,
  pattern: '^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}(\\.\\d{1,6})?(Z|[+-]\\d{2}:\\d{2})$',
})
