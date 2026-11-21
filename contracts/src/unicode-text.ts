import { Kind, Type, TypeRegistry } from '@sinclair/typebox'

const kind = 'bench-intake/unicode-text'

// TypeBox's default interpreter counts UTF-16 units; JSON Schema counts code points.
TypeRegistry.Set(kind, (schema, value) => {
  if (typeof value !== 'string' || schema === null || typeof schema !== 'object') {
    return false
  }
  if (!('minLength' in schema) || !('maxLength' in schema)) {
    return false
  }
  const { minLength, maxLength } = schema
  if (
    typeof minLength !== 'number' ||
    typeof maxLength !== 'number' ||
    !Number.isInteger(minLength) ||
    !Number.isInteger(maxLength) ||
    minLength < 0 ||
    maxLength < minLength
  ) {
    return false
  }
  const length = Array.from(value).length
  return length >= minLength && length <= maxLength
})

export function unicodeText(minLength: number, maxLength: number) {
  return Type.Unsafe<string>({ [Kind]: kind, type: 'string', minLength, maxLength })
}
