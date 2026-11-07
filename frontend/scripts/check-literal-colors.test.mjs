import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import check from './check-literal-colors.cjs'

const { literalColours, scan } = check

function tree(files) {
  const root = mkdtempSync(join(tmpdir(), 'colours-'))
  for (const [path, content] of Object.entries(files)) {
    mkdirSync(join(root, path, '..'), { recursive: true })
    writeFileSync(join(root, path), content)
  }

  return root
}

describe('literal colour check', () => {
  it('finds hex, rgb and hsl literals with their line numbers', () => {
    const source = [
      'const A = styled.div`',
      '  color: #233349;',
      '  border: 1px solid #fff;',
      '  background: rgba(0, 0, 0, 0.5);',
      '  fill: hsl(210 40% 50%);',
      '  outline-color: #ffffffcc;',
      '`',
    ].join('\n')

    expect(literalColours(source)).toEqual([
      { line: 2, literal: '#233349' },
      { line: 3, literal: '#fff' },
      { line: 4, literal: 'rgba(' },
      { line: 5, literal: 'hsl(' },
      { line: 6, literal: '#ffffffcc' },
    ])
  })

  it('ignores token references, hash routes and non-colour hashes', () => {
    const source = [
      'color: ${color.fg};',
      "const href = '#agents'",
      "const route = '#add_lot'",
      "const other = '#settings'",
      'const id = `#${batchId}`',
      "const digest = 'sha256:#abcde'",
    ].join('\n')

    expect(literalColours(source)).toEqual([])
  })

  it('scans source files but skips the theme, tests and fixtures', () => {
    const root = tree({
      'components/Card.tsx': 'const a = "#123456"',
      'components/Card.test.tsx': 'expect(dot).toHaveStyle("color: #123456")',
      'components/masthead/fixtures/Proof.tsx': 'const a = "#123456"',
      'theme/generated/tokens.ts': "bg: '#f3f5f2'",
      'theme/theme.ts': 'const ok = true',
      'App.tsx': 'const b = "rgb(1, 2, 3)"',
      'styles.css': 'a { color: #000; }',
    })

    expect(scan(root)).toEqual([
      { file: 'App.tsx', line: 1, literal: 'rgb(' },
      { file: 'components/Card.tsx', line: 1, literal: '#123456' },
      { file: 'styles.css', line: 1, literal: '#000' },
    ])
  })
})

const { literalValues, compareBaseline, scanValues } = check

function values(source) {
  return literalValues(source).map(({ line, property, literal, tokens }) =>
    [line, property, literal, tokens.join(' ')].join(' | '),
  )
}

describe('literal value check', () => {
  it('exempts a calc() that adjusts a token, not one that adds a prop', () => {
    const source = [
      'const A = styled.div`',
      '  padding: calc(${space[8]} - 1px);',
      '  margin: calc(16px + ${(props) => props.$extra}px);',
      '  gap: calc(var(--space-8) - 1px);',
      '  padding: calc(var(--custom-gap) + 16px);',
      '`',
    ].join('\n')

    expect(values(source)).toEqual(['3 | margin | 16px | space-8', '5 | padding | 16px | space-8'])
  })

  it('reads the font shorthand by part and a media query that spans lines', () => {
    const source = [
      'const A = styled.div`',
      '  font: 600 12px/18px sans-serif;',
      '  @media (',
      '    min-width: 760px) {',
      '  }',
      '`',
    ].join('\n')

    expect(values(source)).toEqual([
      '2 | font-weight | 600 | type-body-strong-weight type-pill-weight type-label-weight',
      '2 | font-size | 12px | type-pill-size',
      '2 | line-height | 18px | type-small-line-height type-pill-line-height type-button-lg-line-height type-mono-line-height type-mono-strong-line-height',
      '3 | @media | 760px | bp-compact',
    ])
  })

  it('reads a value continued on the next line, at the line its property starts', () => {
    const source = [
      'const A = styled.div`',
      '  padding:',
      '    16px;',
      '  box-shadow:',
      '    0 0 0 2px red,',
      '    inset 0 0 0 2px red;',
      '  margin:',
      '    ${gap} 16px;',
      '  box-shadow: 0 1px 2px red, inset 0 0 0 2px blue;',
      '  translate: 0 -8px;',
      '  box-shadow: red 0 0 0 2px;',
      '`',
    ].join('\n')

    expect(values(source)).toEqual([
      '2 | padding | 16px | space-8',
      '4 | box-shadow | 2px | ring-width ring-offset',
      '4 | box-shadow | 2px | ring-width ring-offset',
      '7 | margin | 16px | space-8',
      '9 | box-shadow | 2px | ring-width ring-offset',
      '10 | translate | 8px | offset-toast',
      '11 | box-shadow | 2px | ring-width ring-offset',
    ])
  })

  it('reads a declaration after an unterminated one, an interpolation or another template', () => {
    const source = [
      'const A = styled.div`',
      '  color: red',
      '`',
      'const B = styled.div`',
      '  padding: 16px;',
      '  ${hover}',
      '  gap: 2px',
      '`',
    ].join('\n')

    expect(values(source)).toEqual(['5 | padding | 16px | space-8', '7 | gap | 2px | space-1'])
  })

  it('compares a length only with the tokens meant for its property', () => {
    const source = [
      'const A = styled.div`',
      '  padding: 8px 14px;',
      '  gap: 2px;',
      '  border-radius: 6px;',
      '  min-height: 44px;',
      '  max-width: 1240px;',
      '  width: 20px;',
      '  height: 13px;',
      '  margin: 0 3px;',
      '`',
    ].join('\n')

    expect(values(source)).toEqual([
      '2 | padding | 8px | space-4',
      '2 | padding | 14px | space-7',
      '3 | gap | 2px | space-1',
      '4 | border-radius | 6px | radius-input',
      '5 | min-height | 44px | size-touch',
      '6 | max-width | 1240px | width-content',
      '7 | width | 20px | icon-md',
    ])
  })

  it('checks type, motion, layers, opacity, rings, offsets and media widths', () => {
    const source = [
      'const A = styled.div`',
      '  font-size: 12.5px;',
      '  line-height: 20px;',
      '  font-weight: 650;',
      '  letter-spacing: 0.06em;',
      '  transition: background 80ms linear;',
      '  animation: ${enter} 150ms ease-out;',
      '  z-index: 1000;',
      '  opacity: 0.5;',
      '  outline-offset: 2px;',
      '  box-shadow: 0 0 0 2px ${color.accent};',
      '  from { opacity: 0; transform: translate(-50%, 8px); }',
      '  @media (max-width: 760px) {',
      '  @media (max-width: 700px) {',
      '`',
    ].join('\n')

    expect(values(source)).toEqual([
      '2 | font-size | 12.5px | type-small-size type-mono-size type-mono-strong-size',
      '3 | line-height | 20px | type-body-line-height type-body-strong-line-height',
      '4 | font-weight | 650 | type-h1-weight type-h2-weight type-h3-weight',
      '5 | letter-spacing | 0.06em | type-label-letter-spacing',
      '6 | transition | 80ms | duration-fast',
      '6 | transition | linear | ease-linear',
      '7 | animation | 150ms | duration-toast',
      '7 | animation | ease-out | ease-enter',
      '8 | z-index | 1000 | z-popover',
      '9 | opacity | 0.5 | opacity-disabled',
      '10 | outline-offset | 2px | ring-width ring-offset',
      '11 | box-shadow | 2px | ring-width ring-offset',
      '12 | transform | 8px | offset-toast',
      '13 | @media | 760px | bp-compact',
    ])
  })

  it('reads quoted values inside interpolations and skips token references', () => {
    const source = [
      'const A = styled.div`',
      "  height: ${({ $size }) => ($size === 'lg' ? '20px' : '14px')};",
      '  padding: ${space[6]} ${space[8]};',
      '  border-radius: ${radius.card};',
      'const label = `${count} items`',
      '`',
    ].join('\n')

    expect(values(source)).toEqual(['2 | height | 20px | icon-md', '2 | height | 14px | icon-sm'])
  })

  it('allows calc adjustments of a token, grid tracks and annotated literals', () => {
    const source = [
      'const A = styled.div`',
      '  padding: calc(${space[6]} - 1px) calc(var(--space-4) - 2px);',
      '  grid-template-columns: 20px 1fr;',
      '  width: 32px; /* literal-allowed: image thumbnail, no token for its role */',
      '  // literal-allowed: matches the photo frame',
      '  height: 24px;',
      '  bottom: calc(16px + env(safe-area-inset-bottom));',
      '`',
    ].join('\n')

    expect(values(source)).toEqual(['7 | bottom | 16px | space-8'])
  })

  it('scans source files but skips the masthead scene, theme, tests and fixtures', () => {
    const root = tree({
      'components/Card.tsx': 'const A = styled.div`\n  gap: 8px;\n`',
      'components/Card.test.tsx': 'const A = styled.div`\n  gap: 8px;\n`',
      'electronics-current/scene.ts': 'const A = styled.div`\n  gap: 8px;\n`',
      'components/masthead/fixtures/Proof.tsx': 'const A = styled.div`\n  gap: 8px;\n`',
    })

    expect(scanValues(root).map(({ file, line, literal }) => `${file}:${line} ${literal}`)).toEqual(
      ['components/Card.tsx:2 8px'],
    )
  })

  it('lets the baseline only shrink', () => {
    const finding = (file, property, literal) => ({ file, line: 1, property, literal, tokens: [] })
    const baseline = { 'a.tsx | gap | 8px': 2, 'b.tsx | padding | 12px': 1 }

    expect(
      compareBaseline(baseline, [finding('a.tsx', 'gap', '8px'), finding('a.tsx', 'gap', '8px')]),
    ).toEqual({ grown: [], shrunk: ['b.tsx | padding | 12px'] })
    expect(
      compareBaseline(baseline, [
        finding('a.tsx', 'gap', '8px'),
        finding('a.tsx', 'gap', '8px'),
        finding('a.tsx', 'gap', '8px'),
        finding('b.tsx', 'padding', '12px'),
        finding('c.tsx', 'gap', '4px'),
      ]),
    ).toEqual({ grown: ['a.tsx | gap | 8px', 'c.tsx | gap | 4px'], shrunk: [] })
  })
})
