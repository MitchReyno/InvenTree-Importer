/**
 * Whether PostgreSQL `text` stores this string unchanged: it refuses NUL, and UTF-8 encoding
 * would replace an unpaired surrogate.
 */
export function storableText(value: string) {
  return !value.includes('\u0000') && !/\p{Cs}/u.test(value)
}
