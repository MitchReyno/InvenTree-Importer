import { visit } from 'jsonc-parser'

const DEFAULT_MAX_BYTES = 262144
const MAX_EXPLICIT_BYTES = 2 * 1024 * 1024

/** Reject duplicates (including escaped aliases), unsafe numbers and non-JSON syntax. */
export function strictJson(text: string, maxBytes = DEFAULT_MAX_BYTES): unknown {
  return parsedJson(text, true, maxBytes)
}

/** Evidence extraction only. Unsafe numbers never establish identities or usable outputs. */
export function attributionJson(text: string): unknown {
  return parsedJson(text, false)
}

function parsedJson(text: string, exactNumbers: boolean, maxBytes = DEFAULT_MAX_BYTES): unknown {
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 1 || maxBytes > MAX_EXPLICIT_BYTES) {
    throw new Error('invalid_json_limit')
  }
  if (text.length > maxBytes || new TextEncoder().encode(text).byteLength > maxBytes) {
    throw new Error('json_too_large')
  }
  const stack: (Set<string> | null)[] = []

  const begin = (keys: Set<string> | null) => {
    if (stack.length >= 64) {
      throw new Error('json_depth_exceeded')
    }
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
        if (keys.has(key)) {
          throw new Error('duplicate_json_key')
        }
        if (['__proto__', 'prototype', 'constructor'].includes(key)) {
          throw new Error('reserved_json_key')
        }
        keys.add(key)
      },
      onLiteralValue: (value) => {
        if (
          exactNumbers &&
          typeof value === 'number' &&
          (!Number.isFinite(value) || (Number.isInteger(value) && !Number.isSafeInteger(value)))
        ) {
          throw new Error('unsafe_json_number')
        }
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
  if (value === null || typeof value === 'boolean' || typeof value === 'string') {
    return JSON.stringify(value)
  }
  if (Array.isArray(value)) {
    return `[${value.map(canonical).join(',')}]`
  }
  if (value && typeof value === 'object' && Object.getPrototypeOf(value) === Object.prototype) {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonical((value as Record<string, unknown>)[key])}`)
      .join(',')}}`
  }
  throw new Error('canonical_documents_require_exact_string_scalars')
}
