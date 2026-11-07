import { useSyncExternalStore } from 'react'

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

const MINUTE_MS = 60_000
const listeners = new Set<() => void>()
let minute = Date.now()
let timer: ReturnType<typeof setInterval> | undefined

/** One clock for every relative time on the page, ticking each minute while any is shown. */
function subscribe(listener: () => void) {
  listeners.add(listener)
  if (!timer) {
    minute = Date.now()
    timer = setInterval(() => {
      minute = Date.now()
      listeners.forEach((notify) => notify())
    }, MINUTE_MS)
  }

  return () => {
    listeners.delete(listener)
    if (!listeners.size && timer) {
      clearInterval(timer)
      timer = undefined
    }
  }
}

function useMinute() {
  return useSyncExternalStore(subscribe, () => minute)
}

/** A relative time that keeps the exact one as its machine value and title. */
export function RelativeTime({ at, now }: { at: string; now?: number }) {
  const clock = useMinute()

  return (
    <time dateTime={at} title={new Date(at).toLocaleString()}>
      {relativeTime(at, now ?? clock)}
    </time>
  )
}
