import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import generator from './generate-tokens.cjs'

const { renderCss, renderTs, staleOutputs, writeOutputs, TOKENS_PATH } = generator

const tokens = JSON.parse(readFileSync(TOKENS_PATH, 'utf8'))

describe('token generator', () => {
  it('emits a light block on :root and a dark block, each with its colour scheme', () => {
    const css = renderCss(tokens)

    expect(css).toMatch(/:root,\n\[data-theme='light'\] \{\n {2}color-scheme: light;/)
    expect(css).toMatch(/\[data-theme='dark'\] \{\n {2}color-scheme: dark;/)
    expect(css).toContain('--photo-scrim: rgba(0,0,0,.65);')
    expect(css).toContain('--font-sans: "Public Sans Variable", "Public Sans"')
    expect(css).toContain('--space-5: 10px;')
    expect(css).toContain('--radius-card: 8px;')
  })

  it('paints the page ground from the tokens before the app renders', () => {
    expect(renderCss(tokens)).toContain(
      'html {\n  background-color: var(--bg);\n  color: var(--fg);\n}',
    )
  })

  it('gives dark values only in the dark block', () => {
    const css = renderCss(tokens)
    const dark = css.slice(css.indexOf("[data-theme='dark']"))

    expect(dark).toContain('--part-base: #1d2430;')
    expect(dark).toContain('--part-outline: #9fb0c8;')
    expect(css.slice(0, css.indexOf("[data-theme='dark']"))).toContain('--part-base: #f6f8fa;')
  })

  it('maps token names to typed CSS variable references', () => {
    const ts = renderTs(tokens)

    expect(ts).toContain("surface2: 'var(--surface-2)',")
    expect(ts).toContain("accentWeak: 'var(--accent-weak)',")
    expect(ts).toContain("'5': 'var(--space-5)',")
    expect(ts).toContain("card: 'var(--radius-card)',")
    expect(ts).toContain("export const shadow = 'var(--shadow)'")
    expect(ts).toMatch(
      /h1: 'font-family: var\(--font-sans\); font-size: 20px; line-height: 24px; font-weight: 650;'/,
    )
    expect(ts).toMatch(/label: '.*text-transform: uppercase; letter-spacing: 0\.06em;'/)
  })

  it('names spacing on a 2px scale with no fractional steps', () => {
    const css = renderCss(tokens)

    expect(css).toContain('--space-1: 2px;')
    expect(css).toContain('--space-12: 24px;')
    expect(css).toContain('--space-20: 40px;')
    expect(css).not.toMatch(/--space-\d+-\d+:/)
    expect(css).toContain('--radius-round: 50%;')
  })

  it('emits the motion, layer, breakpoint, opacity and size families as variables', () => {
    const css = renderCss(tokens)

    expect(css).toContain('--duration-fast: 80ms;')
    expect(css).toContain('--ease-enter: ease-out;')
    expect(css).toContain('--z-toast: 1100;')
    expect(css).toContain('--bp-compact: 760px;')
    expect(css).toContain('--opacity-disabled: 0.5;')
    expect(css).toContain('--size-touch: 44px;')
    expect(css).toContain('--icon-md: 20px;')
    expect(css).toContain('--ring-width: 2px;')
    expect(css).toContain('--offset-toast: 8px;')
    expect(css).toContain('--width-review: 1500px;')
  })

  it('maps each family to typed constants, with raw breakpoints for media queries', () => {
    const ts = renderTs(tokens)

    expect(ts).toContain("fast: 'var(--duration-fast)',")
    expect(ts).toContain("loop: 'var(--ease-loop)',")
    expect(ts).toContain("popover: 'var(--z-popover)',")
    expect(ts).toContain("muted: 'var(--opacity-muted)',")
    expect(ts).toContain("control: 'var(--size-control)',")
    expect(ts).toContain("lg: 'var(--icon-lg)',")
    expect(ts).toContain("offset: 'var(--ring-offset)',")
    expect(ts).toContain("enter: 'var(--offset-enter)',")
    expect(ts).toContain("content: 'var(--width-content)',")
    expect(ts).toMatch(/export const breakpoint = \{\n {2}phone: 480,/)
    expect(ts).toMatch(/export const durationMs = \{\n {2}fast: 80,/)
  })

  it('gives each type style its size, line height, weight and letter spacing as variables', () => {
    const css = renderCss(tokens)
    const ts = renderTs(tokens)

    expect(css).toContain('--type-small-size: 12.5px;')
    expect(css).toContain('--type-body-line-height: 20px;')
    expect(css).toContain('--type-h1-weight: 650;')
    expect(css).toContain('--type-label-letter-spacing: 0.06em;')
    expect(ts).toMatch(
      /small: \{ size: 'var\(--type-small-size\)', lineHeight: 'var\(--type-small-line-height\)', weight: 'var\(--type-small-weight\)', letterSpacing: 'var\(--type-small-letter-spacing\)' \}/,
    )
    expect(ts).toMatch(
      /body: 'font-family: var\(--font-sans\); font-size: 14px; line-height: 20px; font-weight: 400;'/,
    )
  })

  it('exposes raw per-theme colours for the masthead scene', () => {
    const ts = renderTs(tokens)

    expect(ts).toContain('export const themeColours = {')
    expect(ts).toMatch(/dark: \{[^}]*'part-base': '#1d2430'/s)
  })

  it('reports stale outputs and is current after writing', () => {
    const directory = mkdtempSync(join(tmpdir(), 'tokens-'))

    expect(staleOutputs(tokens, directory)).toEqual(['tokens.css', 'tokens.ts'])
    writeOutputs(tokens, directory)
    expect(staleOutputs(tokens, directory)).toEqual([])
    writeFileSync(join(directory, 'tokens.ts'), '// edited by hand\n')
    expect(staleOutputs(tokens, directory)).toEqual(['tokens.ts'])
  })

  it('keeps the committed generated files current with tokens.json', () => {
    expect(staleOutputs(tokens)).toEqual([])
  })
})
