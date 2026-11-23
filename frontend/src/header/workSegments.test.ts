import { describe, expect, it } from 'vitest'
import { mostPressing, workState } from './workSegments'

describe('workState', () => {
  it.each([
    // Processing jobs
    ['queued', 'queued'],
    ['running', 'working'],
    ['waiting_for_user', 'waiting_for_you'],
    ['waiting_for_login', 'waiting_for_you'],
    ['waiting_for_capacity', 'queued'],
    ['ready', 'done'],
    ['failed', 'failed'],
    ['cancelled', 'not_started'],
    ['superseded', 'queued'],
    ['interrupted', 'failed'],
    // Sessions
    ['waiting_input', 'waiting_for_you'],
    ['finished', 'done'],
    ['cancelling', 'working'],
    ['resume_unavailable', 'failed'],
    // Import runs and their steps
    ['stopping', 'working'],
    ['settled_complete', 'done'],
    ['settled_incomplete', 'failed'],
    ['recovery_required', 'failed'],
    ['confirmed', 'done'],
    ['not_requested', 'not_started'],
    ['none', 'not_started'],
    ['unknown', 'waiting_for_you'],
    ['mixed', 'waiting_for_you'],
  ] as const)('reads retained %s as %s', (state, expected) => {
    expect(workState(state)).toBe(expected)
  })

  it('reads a job still holding its slot as working, whatever its logical state', () => {
    expect(workState('cancelled', { occupiesLane: true })).toBe('working')
    expect(workState('ready', { occupiesLane: true })).toBe('working')
  })

  it('reads queued work in a paused batch as paused, and a turn still running as working', () => {
    expect(workState('queued', { paused: true })).toBe('paused')
    expect(workState('waiting_for_capacity', { paused: true })).toBe('paused')
    expect(workState('running', { paused: true })).toBe('working')
    expect(workState('ready', { paused: true })).toBe('done')
  })
})

describe('mostPressing', () => {
  it('puts failures first, then what waits for the operator, then work under way', () => {
    expect(mostPressing(['done', 'working', 'failed', 'waiting_for_you'])).toBe('failed')
    expect(mostPressing(['done', 'working', 'waiting_for_you'])).toBe('waiting_for_you')
    expect(mostPressing(['done', 'queued', 'working'])).toBe('working')
    expect(mostPressing(['done', 'queued', 'paused'])).toBe('paused')
    expect(mostPressing(['done', 'not_started'])).toBe('not_started')
    expect(mostPressing(['done', 'done'])).toBe('done')
    expect(mostPressing([])).toBeUndefined()
  })
})
