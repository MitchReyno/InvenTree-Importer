#!/usr/bin/env node
// Rejects literal colours in frontend source; colours come from src/theme tokens.
// Usage: node scripts/check-literal-colors.cjs
const { readdirSync, readFileSync } = require('node:fs')
const { join, relative, sep } = require('node:path')

const SOURCE_DIR = join(__dirname, '..', 'src')
const SOURCE_FILE = /\.(?:[cm]?[jt]sx?|css)$/
const TEST_FILE = /\.(?:test|spec)\.[cm]?[jt]sx?$/
// The theme owns every colour value; fixtures hold preserved photo-stage proofs.
const SKIPPED_DIRECTORIES = new Set(['theme', 'fixtures'])

const HEX = /(?<![\w&$])#(?:[0-9a-fA-F]{8}|[0-9a-fA-F]{6}|[0-9a-fA-F]{3,4})(?![\w-])/g
const FUNCTION = /\b(?:rgba?|hsla?)\(/g

function literalColours(source) {
  const found = []
  source.split('\n').forEach((text, index) => {
    const matches = [...text.matchAll(HEX), ...text.matchAll(FUNCTION)].sort(
      (first, second) => first.index - second.index,
    )
    for (const match of matches) {
      found.push({ line: index + 1, literal: match[0] })
    }
  })

  return found
}

function sourceFiles(directory, root = directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name)
    if (entry.isDirectory()) {
      return SKIPPED_DIRECTORIES.has(entry.name) ? [] : sourceFiles(path, root)
    }
    const isSource = SOURCE_FILE.test(entry.name) && !TEST_FILE.test(entry.name)
    return isSource ? [relative(root, path).split(sep).join('/')] : []
  })
}

function scan(root = SOURCE_DIR) {
  return sourceFiles(root)
    .sort()
    .flatMap((file) =>
      literalColours(readFileSync(join(root, file), 'utf8')).map((found) => ({ file, ...found })),
    )
}

function main() {
  const found = scan()
  for (const { file, line, literal } of found) {
    console.error(`src/${file}:${line}: literal colour ${literal}; use a token from src/theme`)
  }

  return found.length > 0 ? 1 : 0
}

if (require.main === module) {
  process.exitCode = main()
}

module.exports = { literalColours, scan }
