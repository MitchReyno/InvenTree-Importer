import { attributionJson, strictJson } from '@invimport/contracts/json'
import { approvedTagsPresent } from '#/inventory/tags.ts'
import { responsePk } from '#/execution/response.ts'

/** All trustworthy identities survive malformed or multiple output responses. */
export function attributedPks(value: unknown): string[] {
  const values = Array.isArray(value) ? value : [value]
  const pks = new Set<string>()
  for (const item of values) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) {
      continue
    }
    try {
      pks.add(responsePk((item as Record<string, unknown>).pk))
    } catch {
      /* An invalid identity cannot discard valid sibling attribution. */
    }
  }
  return [...pks]
}

export function fieldsMatch(
  value: unknown,
  body: Record<string, string | string[] | null | boolean>,
) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return false
  }
  const row = value as Record<string, unknown>
  return Object.entries(body).every(([key, expected]) => {
    if (key === 'tags' && Array.isArray(expected)) {
      return approvedTagsPresent(expected, row.tags)
    }
    if (key === 'copy_category_parameters') {
      return true
    }
    if (key === 'image' && expected === true) {
      return typeof row.image === 'string' && row.image.length > 0
    }
    const observed =
      typeof row[key] === 'number' && Number.isSafeInteger(row[key]) ? String(row[key]) : row[key]
    return observed === expected
  })
}

export function supportedResponseEvidence(
  status: number,
  bytes: Buffer,
  body: Record<string, string | string[] | null | boolean>,
) {
  const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes)
  const pks = attributedPks(attributionJson(text))
  let confirmed = false
  try {
    confirmed = status === 201 && pks.length === 1 && fieldsMatch(strictJson(text), body)
  } catch {
    /* Loose evidence cannot establish complete output certainty. */
  }
  return { pks, confirmed }
}
