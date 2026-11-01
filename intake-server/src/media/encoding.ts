import type { PoolClient } from 'pg'
import { canonical, strictJson } from '@invimport/contracts/json'
import { idempotent, type CommandScope } from '../db/authority.ts'

/** Media-v1 adds bounded integer pixels/pages without changing stock-v1 canonical bytes. */
export function canonicalMedia(value: unknown): string {
  if (typeof value === 'number') {
    if (!Number.isSafeInteger(value) || value < 0) {
      throw new Error('media_requires_nonnegative_integer_scalars')
    }
    return String(value)
  }
  if (Array.isArray(value)) {
    return `[${value.map(canonicalMedia).join(',')}]`
  }
  if (value && typeof value === 'object' && Object.getPrototypeOf(value) === Object.prototype) {
    const object = value as Record<string, unknown>
    const members = Object.keys(object)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalMedia(object[key])}`)
    return `{${members.join(',')}}`
  }
  return canonical(value)
}

/** Existing command authority retains exact media JSON strings; callers validate parsed outputs. */
export async function idempotentMedia(
  client: PoolClient,
  scope: CommandScope,
  input: unknown,
  work: () => Promise<unknown>,
): Promise<unknown> {
  const retained = await idempotent(
    client,
    scope,
    {
      media_encoding: 'media-json/1',
      bytes: canonicalMedia(input),
    },
    async () => ({
      media_encoding: 'media-json/1',
      bytes: canonicalMedia(await work()),
    }),
  )
  if (!retained || typeof retained !== 'object' || Array.isArray(retained)) {
    throw new Error('media_command_authority_invalid')
  }
  const envelope = retained as Record<string, unknown>
  if (
    Object.keys(envelope).sort().join(',') !== 'bytes,media_encoding' ||
    envelope.media_encoding !== 'media-json/1' ||
    typeof envelope.bytes !== 'string'
  ) {
    throw new Error('media_command_authority_invalid')
  }
  return strictJson(envelope.bytes)
}
