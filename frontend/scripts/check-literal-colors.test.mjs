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
