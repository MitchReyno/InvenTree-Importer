import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import contrast from './check-contrast.cjs'
import generator from './generate-tokens.cjs'

const { contrastRatio, failingPairs, PAIRS } = contrast
const tokens = JSON.parse(readFileSync(generator.TOKENS_PATH, 'utf8'))

function withColour(name, theme, value) {
  const copy = structuredClone(tokens)
  copy.color.tokens.find((token) => token.name === name).value[theme] = value
  return copy
}

describe('contrast check', () => {
  it('computes WCAG ratios', () => {
    expect(contrastRatio('#000000', '#ffffff')).toBeCloseTo(21, 1)
    expect(contrastRatio('#777777', '#ffffff')).toBeCloseTo(4.48, 2)
  })

  it('composites translucent grounds over white before measuring', () => {
    expect(contrastRatio('#ffffff', 'rgba(0,0,0,.65)')).toBeCloseTo(6.99, 1)
    expect(contrastRatio('#ffffff', 'rgba(0,0,0,0)')).toBeCloseTo(1, 2)
  })

  it('passes every documented pair in both themes', () => {
    expect(failingPairs(tokens)).toEqual([])
  })

  it('covers each text token on its grounds in both themes', () => {
    const covered = new Set(PAIRS.map((pair) => pair.text))

    for (const name of ['fg', 'muted', 'accent', 'on-accent', 'ok', 'warn', 'bad', 'info']) {
      expect(covered).toContain(name)
    }
    expect(PAIRS).toContainEqual({ text: 'photo-fg', ground: 'photo-scrim', minimum: 4.5 })
    expect(PAIRS).toContainEqual({ text: 'part-outline', ground: 'masthead-ground', minimum: 3 })
    expect(PAIRS).toContainEqual({ text: 'ai', ground: 'ai-weak', minimum: 3 })
  })

  it('names the pair and theme that fall below the threshold', () => {
    const failures = failingPairs(withColour('muted', 'dark', '#4a4f4c'))

    expect(failures).toContainEqual(
      expect.objectContaining({ theme: 'dark', text: 'muted', ground: 'surface', minimum: 4.5 }),
    )
    expect(failures.every((failure) => failure.theme === 'dark')).toBe(true)
  })
})
