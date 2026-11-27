import { describe, expect, it } from 'vitest'
import { breakpoint } from '#/theme/generated/tokens'
import { formatCount, media } from './media'

describe('media queries', () => {
  it('switches just below each named breakpoint from the tokens', () => {
    expect(media.phone).toBe('@media (max-width: 479.98px)')
    expect(media.narrow).toBe('@media (max-width: 599.98px)')
    expect(media.compact).toBe('@media (max-width: 759.98px)')
    expect(media.stacked).toBe('@media (max-width: 859.98px)')
    expect(media.wide).toBe('@media (max-width: 1179.98px)')
    expect(Object.keys(breakpoint).sort()).toEqual(
      ['compact', 'narrow', 'phone', 'stacked', 'wide'].sort(),
    )
  })

  it('caps counts at 999+', () => {
    expect(formatCount(999)).toBe('999')
    expect(formatCount(1000)).toBe('999+')
  })
})
