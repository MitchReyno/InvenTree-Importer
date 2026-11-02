const MAX_TAG_NAME_LENGTH = 100
const MAX_APPROVED_TAGS = 32

/** Native tag names are case-insensitive; only unambiguous ASCII aliases are normalized locally. */
function asciiTagKey(value: string) {
  return /^[\x20-\x7e]+$/.test(value) ? value.toLowerCase() : null
}

function validTagName(name: string) {
  return Boolean(name.trim()) && name.length <= MAX_TAG_NAME_LENGTH && !/[\x00-\x1f\x7f]/.test(name)
}

function sameTagName(requested: string, observed: string) {
  if (observed === requested) {
    return true
  }
  const requestedKey = asciiTagKey(requested)
  return requestedKey !== null && asciiTagKey(observed) === requestedKey
}

export function approvedTagNamesValid(names: readonly string[]) {
  const keys = new Set<string>()
  for (const name of names) {
    if (!validTagName(name)) {
      return false
    }
    const key = asciiTagKey(name) ?? name
    if (keys.has(key)) {
      return false
    }
    keys.add(key)
  }
  return names.length <= MAX_APPROVED_TAGS
}

export function approvedTagsPresent(
  requested: readonly string[],
  observed: unknown,
): observed is string[] {
  if (!Array.isArray(observed)) {
    return false
  }
  const observedNamesValid = observed.every(
    (name) => typeof name === 'string' && validTagName(name),
  )
  if (!observedNamesValid) {
    return false
  }
  return requested.every((name) => observed.some((actual) => sameTagName(name, actual)))
}
