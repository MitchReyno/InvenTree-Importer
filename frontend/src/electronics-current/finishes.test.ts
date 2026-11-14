import { Color } from 'three'
import { describe, expect, it } from 'vitest'
import {
  BACKGROUND_COLOUR,
  BASE_FILL,
  CREASE_COLOUR,
  DARK_FILL_MIX,
  FINISHES,
  OUTLINE_COLOUR,
  fillFor,
  fills,
} from './finishes'

describe('finishes', () => {
  it('keeps the light finish exactly as before', () => {
    expect(FINISHES.light).toEqual({
      ground: BACKGROUND_COLOUR,
      outline: OUTLINE_COLOUR,
      crease: CREASE_COLOUR,
      base: BASE_FILL,
      highlight: 0xffffff,
    })
    expect(fillFor(fills.epoxy, 'light').getHex()).toBe(fills.epoxy)
  })

  it('takes the dark finish from the dark part tokens', () => {
    expect(FINISHES.dark).toEqual({
      ground: 0x141a17,
      outline: 0x9fb0c8,
      crease: 0x4a5566,
      base: 0x1d2430,
      highlight: 0x1d2430,
    })
  })

  it('mixes dark fills 72% towards the dark base, keeping a trace of each hue', () => {
    const expected = new Color(fills.resistorBlue).lerp(new Color(0x1d2430), DARK_FILL_MIX)

    expect(DARK_FILL_MIX).toBe(0.72)
    expect(fillFor(fills.resistorBlue, 'dark').getHex()).toBe(expected.getHex())
    expect(fillFor(fills.resistorBlue, 'dark').getHex()).not.toBe(
      fillFor(fills.gold, 'dark').getHex(),
    )
  })
})
