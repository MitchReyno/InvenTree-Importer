import { describe, expect, it } from 'vitest'
import { appPage, routeBatchId } from './app-route'

const batchId = '10000000-0000-4000-8000-000000000001'

describe('application routes', () => {
  it('reads Settings and any of its sections as the Settings page, never as a batch', () => {
    expect(appPage('settings')).toBe('settings')
    expect(appPage('settings/inventree')).toBe('settings')
    expect(routeBatchId('settings/inventree')).toBeUndefined()
    expect(appPage('settingsx')).toBeUndefined()
  })

  it('reads Agents as its page and a batch route as its batch', () => {
    expect(appPage('agents')).toBe('agents')
    expect(routeBatchId('agents')).toBeUndefined()
    expect(routeBatchId(`${batchId}/review/lots`)).toBe(batchId)
    expect(routeBatchId('')).toBeUndefined()
    expect(routeBatchId(undefined)).toBeUndefined()
  })
})
