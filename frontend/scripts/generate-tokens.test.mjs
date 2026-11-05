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
    expect(css).toContain('--space-2-5: 10px;')
    expect(css).toContain('--radius-card: 8px;')
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
    expect(ts).toContain("'2-5': 'var(--space-2-5)',")
    expect(ts).toContain("card: 'var(--radius-card)',")
    expect(ts).toContain("export const shadow = 'var(--shadow)'")
    expect(ts).toMatch(
      /h1: 'font-family: var\(--font-sans\); font-size: 20px; line-height: 24px; font-weight: 650;'/,
    )
    expect(ts).toMatch(/label: '.*text-transform: uppercase; letter-spacing: 0\.06em;'/)
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
