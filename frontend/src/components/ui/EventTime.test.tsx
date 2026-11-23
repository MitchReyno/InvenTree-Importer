import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { EventTime, eventTimeText, eventTimeTitle } from './EventTime'

// Local times, so the day labels hold in any time zone the tests run in.
const monday = new Date(2026, 10, 23, 9, 0).getTime()

function at(year: number, month: number, day: number, hour: number, minute: number, second = 0) {
  return new Date(year, month - 1, day, hour, minute, second).toISOString()
}

describe('eventTimeText', () => {
  it('names today and yesterday by word', () => {
    expect(eventTimeText(at(2026, 11, 23, 13, 35), monday, 'en-GB')).toBe('Today 13:35')
    expect(eventTimeText(at(2026, 11, 22, 23, 56), monday, 'en-GB')).toBe('Yesterday 23:56')
  })

  it('gives older events their weekday and date', () => {
    expect(eventTimeText(at(2026, 11, 20, 21, 9), monday, 'en-GB')).toBe('Fri 20 Nov · 21:09')
  })

  it('adds the year outside the current one', () => {
    expect(eventTimeText(at(2025, 11, 20, 21, 9), monday, 'en-GB')).toBe('Thu 20 Nov 2025 · 21:09')
  })

  it('follows the locale’s 12- or 24-hour clock', () => {
    expect(eventTimeText(at(2026, 11, 23, 13, 35), monday, 'en-US')).toBe('Today 1:35 PM')
    expect(eventTimeText(at(2026, 11, 23, 13, 35), monday, 'en-GB')).toBe('Today 13:35')
  })

  it('calls yesterday yesterday across a year boundary', () => {
    const newYear = new Date(2027, 0, 1, 8, 0).getTime()

    expect(eventTimeText(at(2026, 12, 31, 22, 15), newYear, 'en-GB')).toBe('Yesterday 22:15')
  })

  it('gives nothing for an unreadable time', () => {
    expect(eventTimeText('not a time', monday, 'en-GB')).toBeNull()
  })
})

describe('eventTimeTitle', () => {
  it('gives the full date with seconds', () => {
    const title = eventTimeTitle(at(2026, 11, 20, 21, 9, 15), 'en-GB')

    expect(title).toContain('Friday')
    expect(title).toContain('20 November 2026')
    expect(title).toContain('21:09:15')
  })
})

describe('EventTime', () => {
  it('shows the day and time, with the full instant on hover and to assistive technology', () => {
    const value = at(2026, 11, 20, 21, 9, 15)
    render(<EventTime at={value} now={monday} />)
    const time = screen.getByText(eventTimeText(value, monday)!)

    expect(time.tagName).toBe('TIME')
    expect(time).toHaveAttribute('datetime', value)
    expect(time).toHaveAttribute('title', eventTimeTitle(value))
    expect(time).toHaveAccessibleDescription(eventTimeTitle(value)!)
  })

  it('shows an unreadable time as given, without a title', () => {
    render(<EventTime at="sometime" now={monday} />)

    expect(screen.getByText('sometime')).not.toHaveAttribute('title')
  })
})
