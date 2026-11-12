import { describe, expect, it } from 'vitest'
import {
  settingsBack,
  settingsReturnAfter,
  storedSettingsReturn,
  withSettingsReturn,
} from './settings-return'

const batchId = '10000000-0000-4000-8000-000000000001'

describe('the screen Settings returns to', () => {
  it('remembers the screen Settings was opened from and keeps it across sections', () => {
    const records = `${batchId}/review/records`
    const opened = settingsReturnAfter(records, 'settings', undefined)

    expect(opened).toBe(records)
    expect(settingsReturnAfter('settings', 'settings/inventree', opened)).toBe(records)
    expect(settingsReturnAfter('settings/inventree', records, opened)).toBeUndefined()
    expect(settingsReturnAfter('', 'settings', undefined)).toBe('')
  })

  it('replaces or removes the return route and keeps the rest of a history state', () => {
    expect(withSettingsReturn({ settingsReturnTo: 'x', other: 1 }, 'agents')).toEqual({
      settingsReturnTo: 'agents',
      other: 1,
    })
    expect(withSettingsReturn({ settingsReturnTo: 'x', other: 1 }, undefined)).toEqual({ other: 1 })
    expect(withSettingsReturn(null, '')).toEqual({ settingsReturnTo: '' })
  })

  it('reads only a string it stored in the history entry', () => {
    expect(storedSettingsReturn({ settingsReturnTo: 'agents' })).toBe('agents')
    expect(storedSettingsReturn({ settingsReturnTo: 3 })).toBeUndefined()
    expect(storedSettingsReturn(null)).toBeUndefined()
  })

  it('names a batch tab with the batch title, Agents by name, and falls back to Batches', () => {
    expect(settingsBack(`${batchId}/review/records`, 'Mouser 3381-22')).toEqual({
      label: 'Mouser 3381-22 › Review',
      href: `#${batchId}/review/records`,
    })
    expect(settingsBack(`${batchId}`, undefined)).toEqual({
      label: 'the batch › Capture',
      href: `#${batchId}`,
    })
    expect(settingsBack(`${batchId}/approve`, 'Reels')).toEqual({
      label: 'Reels › Changes',
      href: `#${batchId}/approve`,
    })
    expect(settingsBack('agents', undefined)).toEqual({ label: 'Agents', href: '#agents' })
    expect(settingsBack('', undefined)).toEqual({ label: 'Batches', href: '#' })
    expect(settingsBack(undefined, undefined)).toEqual({ label: 'Batches', href: '#' })
  })
})
