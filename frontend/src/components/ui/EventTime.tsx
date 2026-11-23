import { useMinute } from './RelativeTime'

/** The hour and minute in the locale's own 12- or 24-hour clock. */
const CLOCK: Intl.DateTimeFormatOptions = { hour: 'numeric', minute: '2-digit' }
const DATE: Intl.DateTimeFormatOptions = { weekday: 'short', day: 'numeric', month: 'short' }
const FULL: Intl.DateTimeFormatOptions = { dateStyle: 'full', timeStyle: 'medium' }

function sameDay(a: Date, b: Date) {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  )
}

function readable(at: string) {
  const time = Date.parse(at)
  return Number.isNaN(time) ? null : new Date(time)
}

/**
 * "Today 13:35", "Yesterday 23:56" or "Fri 20 Nov · 21:09", with the year outside the current
 * one; null for an unreadable time. Days are the viewer's local calendar days.
 */
export function eventTimeText(at: string, now: number, locale?: string) {
  const event = readable(at)
  if (!event) {
    return null
  }
  const today = new Date(now)
  const yesterday = new Date(today.getFullYear(), today.getMonth(), today.getDate() - 1)
  const clock = new Intl.DateTimeFormat(locale, CLOCK).format(event)
  if (sameDay(event, today)) {
    return `Today ${clock}`
  }
  if (sameDay(event, yesterday)) {
    return `Yesterday ${clock}`
  }

  const options =
    event.getFullYear() === today.getFullYear() ? DATE : { ...DATE, year: 'numeric' as const }
  return `${new Intl.DateTimeFormat(locale, options).format(event).replaceAll(',', '')} · ${clock}`
}

/** The full date and time with seconds, for hover and assistive technology. */
export function eventTimeTitle(at: string, locale?: string) {
  const event = readable(at)
  return event ? new Intl.DateTimeFormat(locale, FULL).format(event) : null
}

/** An event's time, saying which day it was; the exact instant is its machine value and title. */
export function EventTime({ at, now }: { at: string; now?: number }) {
  const clock = useMinute()
  const text = eventTimeText(at, now ?? clock)
  const title = eventTimeTitle(at)

  return (
    <time dateTime={at} title={title ?? undefined}>
      {text ?? at}
    </time>
  )
}
