import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { RelativeTime, localTime, relativeTime } from './RelativeTime'

const now = Date.parse('2026-11-07T12:00:00Z')

describe('localTime', () => {
  it('formats a timestamp, and gives nothing for a missing or invalid one', () => {
    expect(localTime('2026-11-07T12:00:00Z')).toBe(new Date(now).toLocaleString())
    expect(localTime(undefined)).toBeNull()
    expect(localTime('not a date')).toBeNull()
  })
})

describe('relativeTime', () => {
  it('says how long ago in the largest whole unit', () => {
    expect(relativeTime('2026-11-07T11:59:30Z', now)).toBe('just now')
    expect(relativeTime('2026-11-07T11:18:00Z', now)).toBe('42 minutes ago')
    expect(relativeTime('2026-11-07T09:00:00Z', now)).toBe('3 hours ago')
    expect(relativeTime('2026-11-05T12:00:00Z', now)).toBe('2 days ago')
    expect(relativeTime('2026-10-24T12:00:00Z', now)).toBe('2 weeks ago')
  })

  it('keeps the exact time on the element for anyone who needs it', () => {
    render(<RelativeTime at="2026-11-05T12:00:00Z" now={now} />)
    const time = screen.getByText('2 days ago')

    expect(time.tagName).toBe('TIME')
    expect(time).toHaveAttribute('datetime', '2026-11-05T12:00:00Z')
    expect(time).toHaveAttribute('title', new Date('2026-11-05T12:00:00Z').toLocaleString())
  })
})

describe('RelativeTime', () => {
  it('moves on as minutes pass without another render', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(now)
    const { act } = await import('@testing-library/react')
    render(<RelativeTime at="2026-11-07T12:00:00Z" />)
    expect(screen.getByText('just now')).toBeInTheDocument()

    await act(async () => {
      vi.advanceTimersByTime(3 * 60_000)
    })

    expect(screen.getByText('3 minutes ago')).toBeInTheDocument()
    vi.useRealTimers()
  })
})
