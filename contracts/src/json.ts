import { visit } from 'jsonc-parser'

/** Reject duplicates (including escaped aliases), unsafe numbers and non-JSON syntax. */
export function strictJson(text: string): unknown {
  if (Buffer.byteLength(text, 'utf8') > 262144) throw new Error('json_too_large')
  const stack: (Set<string> | null)[] = []
  const begin = (keys: Set<string> | null) => {
    if (stack.length >= 64) throw new Error('json_depth_exceeded')
    stack.push(keys)
  }
  visit(
    text,
    {
      onObjectBegin: () => begin(new Set()),
      onArrayBegin: () => begin(null),
      onObjectEnd: () => {
        stack.pop()
      },
      onArrayEnd: () => {
        stack.pop()
      },
      onObjectProperty: (key) => {
        const keys = stack.at(-1)!
        if (keys.has(key)) throw new Error('duplicate_json_key')
        if (['__proto__', 'prototype', 'constructor'].includes(key))
          throw new Error('reserved_json_key')
        keys.add(key)
      },
      onLiteralValue: (value) => {
        if (
          typeof value === 'number' &&
          (!Number.isFinite(value) || (Number.isInteger(value) && !Number.isSafeInteger(value)))
        )
          throw new Error('unsafe_json_number')
      },
      onError: () => {
        throw new Error('invalid_json')
      },
    },
    { disallowComments: true, allowTrailingComma: false },
  )
  return JSON.parse(text) as unknown
}

/** Version 1 canonical documents sort object keys, preserve ordered arrays and text. */
export function canonical(value: unknown): string {
  if (value === null || typeof value === 'boolean' || typeof value === 'string')
    return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`
  if (value && typeof value === 'object' && Object.getPrototypeOf(value) === Object.prototype) {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonical((value as Record<string, unknown>)[key])}`)
      .join(',')}}`
  }
  throw new Error('canonical_documents_require_exact_string_scalars')
}
