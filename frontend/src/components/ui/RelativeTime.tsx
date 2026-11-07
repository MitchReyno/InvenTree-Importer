const UNITS: [Intl.RelativeTimeFormatUnit, number][] = [
  ['year', 365 * 86_400],
  ['month', 30 * 86_400],
  ['week', 7 * 86_400],
  ['day', 86_400],
  ['hour', 3_600],
  ['minute', 60],
]

const format = new Intl.RelativeTimeFormat(undefined, { numeric: 'always' })

/** "42 minutes ago": the largest whole unit, and "just now" inside a minute. */
export function relativeTime(at: string, now = Date.now()) {
  const seconds = Math.round((Date.parse(at) - now) / 1000)
  for (const [unit, size] of UNITS) {
    if (Math.abs(seconds) >= size) {
      return format.format(Math.trunc(seconds / size), unit)
    }
  }

  return 'just now'
}

/** A relative time that keeps the exact one as its machine value and title. */
export function RelativeTime({ at, now }: { at: string; now?: number }) {
  return (
    <time dateTime={at} title={new Date(at).toLocaleString()}>
      {relativeTime(at, now)}
    </time>
  )
}
