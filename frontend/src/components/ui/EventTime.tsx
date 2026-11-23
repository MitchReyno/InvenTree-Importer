import { useMinute } from './RelativeTime'
import { VisuallyHidden } from './VisuallyHidden'

function startOfDay(time: number) {
  const day = new Date(time)
  day.setHours(0, 0, 0, 0)
  return day.getTime()
}

/** The clock time in the device's own 12- or 24-hour format; a 24-hour clock reads "09:05". */
function clock(time: number, locale?: string) {
  const { hourCycle } = new Intl.DateTimeFormat(locale, { hour: 'numeric' }).resolvedOptions()
  const twentyFour = hourCycle === 'h23' || hourCycle === 'h24'
  return new Intl.DateTimeFormat(locale, {
    hour: twentyFour ? '2-digit' : 'numeric',
    minute: '2-digit',
  }).format(time)
}

/** "Fri 20 Nov", with the year added outside `now`'s year, in that order whatever the locale. */
function day(time: number, now: number, locale?: string) {
  const otherYear = new Date(time).getFullYear() !== new Date(now).getFullYear()
  const parts = new Intl.DateTimeFormat(locale, {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    ...(otherYear ? { year: 'numeric' } : {}),
  }).formatToParts(time)

  const part = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((entry) => entry.type === type)?.value

  return [part('weekday'), part('day'), part('month'), part('year')]
    .filter((value) => value !== undefined)
    .join(' ')
}

/**
 * When an event happened, saying which day: "Today 13:35", "Yesterday 23:56" or
 * "Fri 20 Nov · 21:09". Null for a missing or unreadable time.
 */
export function eventTime(at: string, now: number, locale?: string) {
  const time = Date.parse(at)
  if (Number.isNaN(time)) {
    return null
  }

  const eventDay = startOfDay(time)
  const today = startOfDay(now)
  if (eventDay === today) {
    return `Today ${clock(time, locale)}`
  }
  // A day can be 23 or 25 hours long, so yesterday is the day holding the instant before today.
  if (eventDay === startOfDay(today - 1)) {
    return `Yesterday ${clock(time, locale)}`
  }

  return `${day(time, now, locale)} · ${clock(time, locale)}`
}

/** The full date and time with seconds, for hover and assistive technology. */
function fullTime(time: number) {
  return new Date(time).toLocaleString(undefined, { dateStyle: 'full', timeStyle: 'medium' })
}

/** An event's time in the app's one format, with its full date and seconds on hover. */
export function EventTime({ at, now }: { at: string; now?: number }) {
  const minute = useMinute()
  const text = eventTime(at, now ?? minute)
  if (text === null) {
    return <span>Time not recorded</span>
  }

  const full = fullTime(Date.parse(at))
  return (
    <time dateTime={at} title={full}>
      <span aria-hidden="true">{text}</span>
      <VisuallyHidden>{full}</VisuallyHidden>
    </time>
  )
}
