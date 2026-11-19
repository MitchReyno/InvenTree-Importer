import { describe, expect, it } from 'vitest'
import { debugInfoText } from './debug-info'

const now = Date.parse('2026-11-19T03:30:00Z')
const health = { state: 'live' as const, observedAt: now - 2000, truncated: false }

describe('debugInfoText', () => {
  it('lists the build, route, readiness and live-update state', () => {
    const text = debugInfoText({
      route: 'b1/processing/research',
      readiness: {
        status: 'ready',
        api_version: 'bench-intake-app/1',
        deployment: 'restricted-local-development',
        identity: 'deferred_T11',
        research: 'unqualified',
        media: 'disabled',
        updates: 'websocket-with-polling-fallback',
        apply: 'separately-supervised-owned-fake-only',
      },
      health,
      now,
    })

    expect(text.split('\n')).toEqual([
      'Bench Intake debug info',
      'Taken: 2026-11-19T03:30:00.000Z',
      'Build: development',
      'Route: b1/processing/research',
      'API version: bench-intake-app/1',
      'Deployment: restricted-local-development',
      'Media: disabled',
      'Research: unqualified',
      'Inventory execution: separately-supervised-owned-fake-only',
      'Live updates: live, last frame 2 s ago',
    ])
  })

  it('says when readiness failed or was never read', () => {
    const base = { route: '', health: { ...health, observedAt: null }, now }

    expect(debugInfoText({ ...base, readiness: 'unavailable' })).toContain('Readiness: unavailable')
    expect(debugInfoText({ ...base, readiness: undefined })).toContain('Readiness: not checked')
    expect(debugInfoText({ ...base, readiness: undefined })).toContain('Route: (batches)')
    expect(debugInfoText({ ...base, readiness: undefined })).toContain('no frame yet')
  })
})
