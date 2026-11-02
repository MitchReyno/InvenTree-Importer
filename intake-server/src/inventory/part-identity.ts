import { approvedTagsPresent } from './tags.ts'

export interface PartIdentityRead {
  category_id: string
  tags?: string[]
}

export function partIdentitySatisfies(
  observed: unknown,
  expected: PartIdentityRead,
): observed is PartIdentityRead {
  if (!observed || typeof observed !== 'object' || Array.isArray(observed)) {
    return false
  }
  const unexpectedField = Object.keys(observed).some(
    (key) => key !== 'category_id' && key !== 'tags',
  )
  if (unexpectedField) {
    return false
  }
  const identity = observed as Record<string, unknown>
  if (identity.category_id !== expected.category_id) {
    return false
  }
  if (expected.tags === undefined) {
    return identity.tags === undefined
  }
  return approvedTagsPresent(expected.tags, identity.tags)
}
