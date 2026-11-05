#!/usr/bin/env node
// Fails when a documented text/ground token pair is below its WCAG contrast threshold
// in either theme. Usage: node scripts/check-contrast.cjs
const { readFileSync } = require('node:fs')
const { TOKENS_PATH } = require('./generate-tokens.cjs')

const TEXT = 4.5
const NON_TEXT = 3

function pairs(text, grounds, minimum = TEXT) {
  return grounds.map((ground) => ({ text, ground, minimum }))
}

// Each text token on the grounds the design system documents for it.
const PAIRS = [
  ...pairs('fg', [
    'bg',
    'surface',
    'surface-2',
    'accent-weak',
    'ok-weak',
    'warn-weak',
    'bad-weak',
    'info-weak',
    'masthead-ground',
  ]),
  ...pairs('muted', ['bg', 'surface', 'surface-2', 'accent-weak', 'warn-weak', 'masthead-ground']),
  ...pairs('accent', ['bg', 'surface', 'surface-2', 'accent-weak']),
  ...pairs('on-accent', ['accent']),
  ...pairs('ok', ['surface', 'ok-weak']),
  ...pairs('warn', ['surface', 'warn-weak']),
  ...pairs('bad', ['surface', 'bad-weak']),
  ...pairs('info', ['surface', 'info-weak']),
  // Inverted chips: toast, selected segment and filter, bulk bar.
  ...pairs('bg', ['fg']),
  ...pairs('bar-fg', ['bar']),
  ...pairs('photo-fg', ['photo-stage', 'photo-scrim']),
  ...pairs('dev-fg', ['dev-bg']),
  // Non-text: focus ring and the masthead part outline.
  ...pairs('accent', ['bg', 'surface'], NON_TEXT),
  ...pairs('part-outline', ['masthead-ground'], NON_TEXT),
]

function parseColour(value) {
  const hex = /^#([0-9a-f]{6})$/i.exec(value)
  if (hex) {
    const digits = hex[1]
    return {
      rgb: [0, 2, 4].map((offset) => parseInt(digits.slice(offset, offset + 2), 16)),
      alpha: 1,
    }
  }
  const rgba = /^rgba?\(([^)]+)\)$/.exec(value)
  if (!rgba) {
    throw new Error(`Unsupported colour value: ${value}`)
  }
  const parts = rgba[1].split(',').map((part) => Number(part.trim()))
  return { rgb: parts.slice(0, 3), alpha: parts.length > 3 ? parts[3] : 1 }
}

// Translucent grounds are measured over white, their lightest backdrop.
function opaque(value) {
  const { rgb, alpha } = parseColour(value)
  return rgb.map((channel) => channel * alpha + 255 * (1 - alpha))
}

function luminance(rgb) {
  const [red, green, blue] = rgb.map((channel) => {
    const unit = channel / 255
    return unit <= 0.03928 ? unit / 12.92 : ((unit + 0.055) / 1.055) ** 2.4
  })

  return 0.2126 * red + 0.7152 * green + 0.0722 * blue
}

function contrastRatio(foreground, ground) {
  const first = luminance(opaque(foreground))
  const second = luminance(opaque(ground))
  const lighter = Math.max(first, second)
  const darker = Math.min(first, second)

  return (lighter + 0.05) / (darker + 0.05)
}

function failingPairs(tokens) {
  const themes = tokens.color.themes.map((theme) => theme.id)
  const failures = []
  for (const theme of themes) {
    const values = Object.fromEntries(
      tokens.color.tokens.map((token) => [token.name, token.value[theme]]),
    )
    for (const pair of PAIRS) {
      const ratio = contrastRatio(values[pair.text], values[pair.ground])
      if (ratio < pair.minimum) {
        failures.push({ theme, ...pair, ratio: Math.round(ratio * 100) / 100 })
      }
    }
  }

  return failures
}

function main() {
  const tokens = JSON.parse(readFileSync(TOKENS_PATH, 'utf8'))
  const failures = failingPairs(tokens)
  for (const failure of failures) {
    console.error(
      `${failure.theme}: ${failure.text} on ${failure.ground} is ${failure.ratio}:1, below ${failure.minimum}:1`,
    )
  }

  return failures.length > 0 ? 1 : 0
}

if (require.main === module) {
  process.exitCode = main()
}

module.exports = { contrastRatio, failingPairs, PAIRS }
