import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { EventTime, eventTime } from './EventTime'

// Monday 23 November 2026, 14:00 local time.
const now = new Date(2026, 10, 23, 14, 0).getTime()

const at = (...parts: [number, number, number, number, number, number?]) =>
  new Date(...parts).toISOString()

describe('eventTime', () => {
  it('says today, yesterday, or the weekday and date', () => {
    expect(eventTime(at(2026, 10, 23, 13, 35), now, 'en-GB')).toBe('Today 13:35')
    expect(eventTime(at(2026, 10, 22, 23, 56), now, 'en-GB')).toBe('Yesterday 23:56')
    expect(eventTime(at(2026, 10, 20, 21, 9), now, 'en-GB')).toBe('Fri 20 Nov · 21:09')
  })

  it('adds the year outside the current one', () => {
    expect(eventTime(at(2025, 11, 31, 9, 5), now, 'en-GB')).toBe('Wed 31 Dec 2025 · 09:05')
  })

  it('follows the locale’s 12- or 24-hour clock', () => {
    expect(eventTime(at(2026, 10, 23, 13, 35), now, 'en-US')).toBe('Today 1:35 PM')
  })

  it('gives nothing for an unreadable time', () => {
    expect(eventTime('not a time', now)).toBeNull()
  })
})

describe('EventTime', () => {
  it('keeps the exact time as its machine value and the full date with seconds on hover', () => {
    const value = at(2026, 10, 23, 13, 34, 15)
    const { container } = render(<EventTime at={value} now={now} />)
    const time = container.querySelector('time')!

    expect(time).toHaveAttribute('datetime', value)
    expect(time.getAttribute('title')).toMatch(/2026/)
    expect(time.getAttribute('title')).toMatch(/15/)
    expect(time.textContent).toContain(eventTime(value, now))
    expect(screen.getByText(time.getAttribute('title')!)).toBeInTheDocument()
  })
})
