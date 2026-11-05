import type { ConnectionStatusDto } from '@invimport/contracts'
import { describe, expect, it } from 'vitest'
import { targetStatus, targetSummary } from './observations'

type Target = NonNullable<ConnectionStatusDto['target']>

const now = Date.parse('2026-11-06T10:00:00Z')
const fresh = '2026-11-06T09:59:50Z'

function target(overrides: Partial<Target>): Target {
  return {
    state: 'reachable',
    freshness: 'fresh',
    observed_at: fresh,
    navigation_url: 'https://inventory.example.test/',
    ...overrides,
  } as Target
}

describe('targetStatus', () => {
  it.each([
    [
      'reachable and fresh',
      target({}),
      false,
      'inventory.example.test',
      'ok',
      'inventory.example.test',
    ],
    [
      'reachable without a safe URL',
      target({ navigation_url: null }),
      false,
      'InvenTree connected',
      'ok',
      'Connected',
    ],
    ['stale', target({ freshness: 'stale' }), false, 'InvenTree status stale', 'warn', 'Stale'],
    [
      'old observation',
      target({ observed_at: '2026-11-06T09:00:00Z' }),
      false,
      'InvenTree status stale',
      'warn',
      'Stale',
    ],
    [
      'target unavailable',
      target({ state: 'unavailable' }),
      false,
      'InvenTree unavailable',
      'bad',
      'Offline',
    ],
    ['API unavailable', target({}), true, 'InvenTree unavailable', 'bad', 'Offline'],
    [
      'unconfigured',
      target({ state: 'unconfigured' }),
      false,
      'InvenTree target unconfigured',
      'muted',
      'Not set up',
    ],
    [
      'unobserved',
      target({ freshness: 'unobserved' }),
      false,
      'InvenTree status unknown',
      'muted',
      'Unknown',
    ],
    ['not read yet', undefined, false, 'Reading connection…', 'muted', 'Reading…'],
  ] as const)('%s', (_case, value, unavailable, summary, tone, short) => {
    expect(targetStatus(value, unavailable, now)).toEqual({ summary, tone, short })
    expect(targetSummary(value, unavailable, now)).toBe(summary)
  })
})
