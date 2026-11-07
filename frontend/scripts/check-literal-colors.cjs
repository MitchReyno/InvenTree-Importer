#!/usr/bin/env node
// Rejects literal colours in frontend source; colours come from src/theme tokens. Also finds
// literal styling values that equal a token meant for their CSS property (design D11), which may
// not grow beyond the recorded baseline.
// Usage: node scripts/check-literal-colors.cjs [--update-baseline]
const { existsSync, readdirSync, readFileSync, writeFileSync } = require('node:fs')
const { join, relative, sep } = require('node:path')

const SOURCE_DIR = join(__dirname, '..', 'src')
const SOURCE_FILE = /\.(?:[cm]?[jt]sx?|css)$/
const TEST_FILE = /\.(?:test|spec)\.[cm]?[jt]sx?$/
// The theme owns every colour value; fixtures hold preserved photo-stage proofs.
const SKIPPED_DIRECTORIES = new Set(['theme', 'fixtures'])
// The masthead scene's palette and geometry are not CSS and have no tokens.
const VALUE_SKIPPED_DIRECTORIES = new Set([...SKIPPED_DIRECTORIES, 'electronics-current'])
const TOKENS_PATH = join(__dirname, '..', 'src', 'theme', 'tokens.json')
const BASELINE_PATH = join(__dirname, 'literal-values.baseline.json')
const ALLOW = /literal-allowed:\s*\S/
// A comment-only line with the allowance covers the line after it.
const ALLOW_LINE = /^\s*(?:\/\/|\/\*).*literal-allowed:\s*\S/

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

function sourceFiles(directory, root = directory, skipped = SKIPPED_DIRECTORIES) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name)
    if (entry.isDirectory()) {
      return skipped.has(entry.name) ? [] : sourceFiles(path, root, skipped)
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

// Token values by the CSS properties they are meant for (design D11).
function tokenFamilies(tokens) {
  const named = (family, prefix = '') =>
    tokens[family].tokens
      .filter((token) => token.name.startsWith(prefix))
      .map((token) => ({ name: token.name, value: token.value }))
  const typeStyles = tokens.type.groups.flatMap((group) => group.styles)
  const typePart = (suffix, field) =>
    typeStyles
      .filter((style) => style[field] && style[field] !== '0')
      .map((style) => ({ name: `type-${style.name}-${suffix}`, value: String(style[field]) }))
  return {
    space: named('spacing'),
    radius: named('radius'),
    size: [...named('size', 'size-'), ...named('size', 'icon-')],
    maxWidth: named('size', 'width-'),
    ring: named('size', 'ring-'),
    offset: named('size', 'offset-'),
    fontSize: typePart('size', 'fontSize'),
    lineHeight: typePart('line-height', 'lineHeight'),
    fontWeight: typePart('weight', 'fontWeight'),
    letterSpacing: typePart('letter-spacing', 'letterSpacing'),
    duration: named('duration'),
    easing: named('easing'),
    zIndex: named('zIndex'),
    opacity: named('opacity'),
    breakpoint: named('breakpoint'),
  }
}

const PROPERTY_FAMILIES = [
  [
    /^(?:margin|padding)(?:-[a-z-]+)?$|^(?:row-|column-)?gap$|^inset(?:-[a-z-]+)?$|^(?:top|right|bottom|left)$/,
    'space',
  ],
  [/^border(?:-[a-z]+)*-radius$/, 'radius'],
  [/^(?:min-|max-)?height$|^(?:min-)?width$/, 'size'],
  [/^max-width$/, 'maxWidth'],
  [/^outline(?:-width|-offset)?$/, 'ring'],
  [/^box-shadow$/, 'ring'],
  [/^transform$|^translate$/, 'offset'],
  [/^font-size$/, 'fontSize'],
  [/^line-height$/, 'lineHeight'],
  [/^font-weight$/, 'fontWeight'],
  [/^letter-spacing$/, 'letterSpacing'],
  [/^(?:transition|animation)(?:-duration)?$/, 'duration'],
  [/^(?:transition|animation)(?:-timing-function)?$/, 'easing'],
  [/^z-index$/, 'zIndex'],
  [/^opacity$/, 'opacity'],
]

const NUMBER = /(?<![\w.-])(-?(?:\d+\.?\d*|\.\d+))(px|em|rem|%|ms|s)?(?![\w.%(])/g
const EASING = /(?<![\w-])(ease-in-out|ease-in|ease-out|linear)(?![\w(-])/g

// Keeps template-literal text (styled-components CSS) at its line positions and blanks the rest.
// An interpolation becomes '§' plus the contents of its quoted strings and nested templates.
function templateText(source) {
  let out = ''
  const stack = ['js']
  for (let index = 0; index < source.length; index++) {
    const char = source[index]
    const next = source[index + 1]
    const top = stack[stack.length - 1]
    const inTemplate = stack.includes('tpl')
    if (char === '\n') {
      out += '\n'
      if (top === 'line-comment') stack.pop()
      continue
    }
    if (top === 'line-comment' || top === 'block-comment') {
      if (top === 'block-comment' && char === '*' && next === '/') {
        stack.pop()
        out += '  '
        index++
        continue
      }
      out += ' '
      continue
    }
    if (top === 'tpl') {
      if (char === '\\') {
        out += char + (next ?? '')
        index++
      } else if (char === '`') {
        stack.pop()
        // A template boundary ends any declaration left without a semicolon.
        out += ';'
      } else if (char === '$' && next === '{') {
        stack.push({ depth: 0 })
        out += '§ '
        index++
      } else {
        out += char
      }
      continue
    }
    if (top === "'" || top === '"') {
      if (char === '\\') {
        out += inTemplate ? char + (next ?? '') : '  '
        index++
      } else if (char === top) {
        stack.pop()
        out += ' '
      } else {
        out += inTemplate ? char : ' '
      }
      continue
    }
    // JavaScript, at top level or inside an interpolation.
    if (char === '/' && next === '/') {
      stack.push('line-comment')
      out += '  '
      index++
    } else if (char === '/' && next === '*') {
      stack.push('block-comment')
      out += '  '
      index++
    } else if (char === "'" || char === '"') {
      stack.push(char)
      out += ' '
    } else if (char === '`') {
      stack.push('tpl')
      out += ';'
    } else if (typeof top === 'object' && char === '{') {
      top.depth++
      out += ' '
    } else if (typeof top === 'object' && char === '}') {
      if (top.depth === 0) stack.pop()
      else top.depth--
      out += ' '
    } else {
      out += ' '
    }
  }
  return out
}

// Removes calc() groups that adjust a token, such as calc(var(--space-6) - 1px).
function withoutTokenCalc(value) {
  let result = value
  for (
    let start = result.indexOf('calc(');
    start >= 0;
    start = result.indexOf('calc(', start + 1)
  ) {
    let depth = 0
    let end = start + 4
    for (; end < result.length; end++) {
      if (result[end] === '(') depth++
      if (result[end] === ')' && --depth === 0) break
    }
    const group = result.slice(start, end + 1)
    if (group.includes('§') || group.includes('var(')) {
      result = result.slice(0, start) + ' '.repeat(group.length) + result.slice(end + 1)
    }
  }
  return result
}

function sameValue(literal, token) {
  if (literal === token) return true
  const a = parseFloat(literal)
  const b = parseFloat(token)
  const unit = (text) => text.replace(/^-?[\d.]+/, '')
  return !Number.isNaN(a) && a === b && unit(literal) === unit(token)
}

function literalsFor(family, property, value) {
  if (family === 'easing') {
    return [...value.matchAll(EASING)].map((match) => match[1])
  }
  if (property === 'box-shadow') {
    // Only rings, outer or inset: no offset or blur, so each layer's fourth length is its spread.
    return value
      .split(/,(?![^(]*\))/)
      .map((layer) => layer.trim().match(/^(?:inset )?0(?:px)? 0(?:px)? 0(?:px)? (\d+px)/))
      .filter(Boolean)
      .map((ring) => ring[1])
  }
  const numbers = [...value.matchAll(NUMBER)].map((match) => match[1] + (match[2] ?? ''))
  if (property === 'translate') {
    return numbers
      .map((literal) => literal.replace(/^-/, ''))
      .filter((literal) => parseFloat(literal) !== 0)
  }
  if (family === 'offset') {
    const translated = [...value.matchAll(/translate[XY3d]*\(([^)]*)\)/g)].flatMap((match) =>
      [...match[1].matchAll(NUMBER)].map((part) => part[1] + (part[2] ?? '')),
    )
    return translated.map((literal) => literal.replace(/^-/, ''))
  }
  return numbers.filter((literal) => !literal.startsWith('-') && parseFloat(literal) !== 0)
}

const DECLARATION_START = /^\s*[a-z-]+\s*:/

// An interpolation line carries on a declaration still waiting for its value or its next comma
// part; a bare interpolation line (a mixin) ends it.
function continues(text, line) {
  return /:\s*$|,\s*$/.test(text) || /[;,]\s*$/.test(line)
}

// Declarations across the whole text, so a value continued on the next line is still read. A
// declaration starts on a `property:` line and ends at the next one, a mixin line or a ';', '{'
// or '}'.
function declarations(text) {
  const result = []
  let current = null
  const finish = () => {
    if (current) {
      const match = current.text.match(/^\s*([a-z-]+)\s*:\s*([\s\S]*?)\s*$/)
      if (match && match[2]) {
        result.push({ ...current, property: match[1], value: match[2].replace(/\s+/g, ' ') })
      }
    }
    current = null
  }
  text.split('\n').forEach((line, index) => {
    for (const [part, position] of line.split(/(?=[;{}])/).map((piece, n) => [piece, n])) {
      const body = position === 0 ? part : part.slice(1)
      if (position > 0) finish()
      if (body.includes('@media')) {
        finish()
        continue
      }
      if (DECLARATION_START.test(body)) {
        finish()
        current = { first: index, last: index, text: body }
      } else if (/^\s*§/.test(body) && !(current && continues(current.text, line))) {
        finish()
      } else if (current && body.trim()) {
        current.last = index
        current.text += ' ' + body
      }
    }
  })
  finish()
  return result
}

let defaultFamilies = null

function literalValues(source, families) {
  const tokens =
    families ?? (defaultFamilies ??= tokenFamilies(JSON.parse(readFileSync(TOKENS_PATH, 'utf8'))))
  const lines = source.split('\n')
  const text = templateText(source)
  const allowed = (index) =>
    ALLOW.test(lines[index]) || (index > 0 && ALLOW_LINE.test(lines[index - 1]))
  const found = []
  text.split('\n').forEach((line, index) => {
    const media = line.match(/@media[^{]*/)
    if (!media || allowed(index)) return
    for (const match of media[0].matchAll(/(?:min|max)-width:\s*(\d+(?:\.\d+)?px)/g)) {
      const matches = tokens.breakpoint.filter((token) => sameValue(match[1], token.value))
      if (matches.length > 0) {
        found.push({
          line: index + 1,
          property: '@media',
          literal: match[1],
          tokens: matches.map((token) => token.name),
        })
      }
    }
  })
  for (const { first, last, property, value } of declarations(text)) {
    if (property.startsWith('grid-template')) continue
    const span = Array.from({ length: last - first + 1 }, (_, offset) => first + offset)
    if (span.some(allowed)) continue
    const plain = withoutTokenCalc(value)
    for (const [pattern, family] of PROPERTY_FAMILIES) {
      if (!pattern.test(property)) continue
      for (const literal of literalsFor(family, property, plain)) {
        const matches = tokens[family].filter((token) => sameValue(literal, token.value))
        if (matches.length > 0) {
          found.push({
            line: first + 1,
            property,
            literal,
            tokens: matches.map((token) => token.name),
          })
        }
      }
    }
  }
  found.sort((a, b) => a.line - b.line)
  return found
}

function scanValues(root = SOURCE_DIR) {
  return sourceFiles(root, root, VALUE_SKIPPED_DIRECTORIES)
    .sort()
    .flatMap((file) =>
      literalValues(readFileSync(join(root, file), 'utf8')).map((found) => ({ file, ...found })),
    )
}

function baselineKey({ file, property, literal }) {
  return `${file} | ${property} | ${literal}`
}

function counts(findings) {
  const result = {}
  for (const finding of findings) {
    const key = baselineKey(finding)
    result[key] = (result[key] ?? 0) + 1
  }
  return result
}

// Keys whose count grew beyond the baseline, and keys the baseline still holds more of.
function compareBaseline(baseline, findings) {
  const current = counts(findings)
  const keys = [...new Set([...Object.keys(baseline), ...Object.keys(current)])].sort()
  return {
    grown: keys.filter((key) => (current[key] ?? 0) > (baseline[key] ?? 0)),
    shrunk: keys.filter((key) => (current[key] ?? 0) < (baseline[key] ?? 0)),
  }
}

function sortedCounts(findings) {
  return Object.fromEntries(Object.entries(counts(findings)).sort(([a], [b]) => a.localeCompare(b)))
}

function main(argv) {
  const colours = scan()
  for (const { file, line, literal } of colours) {
    console.error(`src/${file}:${line}: literal colour ${literal}; use a token from src/theme`)
  }

  const values = scanValues()
  const baseline = existsSync(BASELINE_PATH)
    ? JSON.parse(readFileSync(BASELINE_PATH, 'utf8'))
    : null
  const { grown, shrunk } = compareBaseline(baseline ?? {}, values)
  if (argv.includes('--update-baseline')) {
    if (baseline && grown.length > 0) {
      console.error(`The baseline may only shrink; these grew: ${grown.join('; ')}`)
      return 1
    }
    writeFileSync(BASELINE_PATH, `${JSON.stringify(sortedCounts(values), null, 2)}\n`)
    console.log(`Recorded ${values.length} literal values in ${BASELINE_PATH}`)
    return colours.length > 0 ? 1 : 0
  }
  if (!baseline) {
    console.error(
      'No literal-value baseline. Record it with: node scripts/check-literal-colors.cjs --update-baseline',
    )
    return 1
  }
  const grownKeys = new Set(grown)
  for (const finding of values.filter((value) => grownKeys.has(baselineKey(value)))) {
    console.error(
      `src/${finding.file}:${finding.line}: ${finding.property} ${finding.literal} equals ${finding.tokens.join(' or ')}; use the token, or say why not with a literal-allowed: comment`,
    )
  }
  if (shrunk.length > 0) {
    console.error(
      `The literal-value baseline is stale (${shrunk.length} entries shrank). Record the smaller baseline: node scripts/check-literal-colors.cjs --update-baseline`,
    )
  }

  return colours.length > 0 || grown.length > 0 || shrunk.length > 0 ? 1 : 0
}

if (require.main === module) {
  process.exitCode = main(process.argv.slice(2))
}

module.exports = { compareBaseline, literalColours, literalValues, scan, scanValues }
