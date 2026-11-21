#!/usr/bin/env node
// Unused-code check: runs knip over frontend, contracts, intake-server and media-decoder (configured in
// knip.json) and fails when unused files, exports, types or dependencies grow beyond the
// recorded baseline. The baseline may only shrink.
//
// Code kept for planned work carries `@planned <BI-NNN or task N.N> <reason>`: on an export's
// JSDoc it hides that export (knip's tag filter), and in a file's first comment it keeps the
// file. A tag that names no task or item fails the check.
//
// Usage: node tooling/unused-code/check.mjs [--update-baseline]
import { spawnSync } from 'node:child_process'
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const baselinePath = join(dirname(fileURLToPath(import.meta.url)), 'baseline.json')
const sourceRoots = ['frontend/src', 'contracts/src', 'intake-server/src', 'media-decoder/src']
const SOURCE_FILE = /\.(?:[cm]?[jt]sx?)$/
const PLANNED = /@planned\b(.*)/
const PLANNED_REFERENCE = /^\s*(?:BI-\d{3,}|task \d+(?:\.\d+)?)\b\s*\S/

// knip's issue keys, as the kinds this check reports.
const KINDS = {
  files: 'file',
  dependencies: 'dependency',
  devDependencies: 'devDependency',
  unlisted: 'unlisted',
  exports: 'export',
  types: 'type',
  nsExports: 'export',
  nsTypes: 'type',
}

export function findingsFromKnip(report) {
  return report.issues.flatMap((issue) =>
    Object.entries(KINDS).flatMap(([key, kind]) =>
      (issue[key] ?? []).map((item) => ({
        file: issue.file,
        kind,
        name: kind === 'file' ? '' : item.name,
        line: item.line ?? 1,
      })),
    ),
  )
}

function sourceFiles(directory) {
  if (!existsSync(directory)) {
    return []
  }
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name)
    if (entry.isDirectory()) {
      return entry.name === 'node_modules' || entry.name === 'generated' ? [] : sourceFiles(path)
    }
    return SOURCE_FILE.test(entry.name) ? [path] : []
  })
}

function relativePath(base, path) {
  return relative(base, path).split(sep).join('/')
}

export function invalidPlannedTags(base, roots = sourceRoots) {
  return roots.flatMap((directory) =>
    sourceFiles(join(base, directory)).flatMap((path) =>
      readFileSync(path, 'utf8')
        .split('\n')
        .flatMap((text, index) => {
          const match = text.match(PLANNED)
          return match && !PLANNED_REFERENCE.test(match[1].replace(/\*\/.*$/, ''))
            ? [{ file: relativePath(base, path), line: index + 1 }]
            : []
        }),
    ),
  )
}

// A file whose leading comment says it is kept for planned work is not an unused file.
function plannedFile(path) {
  const leading = readFileSync(path, 'utf8').match(/^\s*(?:\/\/[^\n]*\n\s*|\/\*[\s\S]*?\*\/\s*)+/)
  return Boolean(leading && PLANNED.test(leading[0]))
}

export function withoutPlannedFiles(base, findings) {
  return findings.filter(
    (finding) => finding.kind !== 'file' || !plannedFile(join(base, finding.file)),
  )
}

function key({ file, kind, name }) {
  return `${file} | ${kind} | ${name}`
}

export function compareBaseline(baseline, findings) {
  const current = new Set(findings.map(key))
  const recorded = new Set(baseline)
  return {
    grown: [...current].filter((entry) => !recorded.has(entry)).sort(),
    shrunk: [...recorded].filter((entry) => !current.has(entry)).sort(),
  }
}

function runKnip() {
  const result = spawnSync(join(root, 'node_modules', '.bin', 'knip'), ['--reporter', 'json'], {
    cwd: root,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  })
  // knip exits non-zero when it finds anything; only a missing report is an error.
  if (!result.stdout.trim().startsWith('{')) {
    throw new Error(`knip failed: ${result.stderr || result.stdout}`)
  }
  return JSON.parse(result.stdout)
}

function main(argv) {
  const invalid = invalidPlannedTags(root)
  for (const { file, line } of invalid) {
    console.error(
      `${file}:${line}: @planned must name the task or item, e.g. "@planned BI-005 <why>"`,
    )
  }

  const findings = withoutPlannedFiles(root, findingsFromKnip(runKnip()))
  const baseline = existsSync(baselinePath) ? JSON.parse(readFileSync(baselinePath, 'utf8')) : null
  const { grown, shrunk } = compareBaseline(baseline ?? [], findings)
  if (argv.includes('--update-baseline')) {
    if (baseline && grown.length > 0) {
      console.error(`The unused-code baseline may only shrink; new: ${grown.join('; ')}`)
      return 1
    }
    writeFileSync(
      baselinePath,
      `${JSON.stringify([...new Set(findings.map(key))].sort(), null, 2)}\n`,
    )
    console.log(
      `Recorded ${findings.length} unused-code findings in tooling/unused-code/baseline.json`,
    )
    return invalid.length > 0 ? 1 : 0
  }
  if (!baseline) {
    console.error(
      'No unused-code baseline. Record it with: node tooling/unused-code/check.mjs --update-baseline',
    )
    return 1
  }
  const grownKeys = new Set(grown)
  for (const finding of findings.filter((item) => grownKeys.has(key(item)))) {
    const what = finding.kind === 'file' ? 'unused file' : `unused ${finding.kind} ${finding.name}`
    console.error(
      `${finding.file}:${finding.line}: ${what}; remove it, or keep it for planned work with "@planned <BI-NNN or task N.N> <why>"`,
    )
  }
  if (shrunk.length > 0) {
    console.error(
      `The unused-code baseline is stale (${shrunk.length} entries removed). Record the smaller baseline: node tooling/unused-code/check.mjs --update-baseline`,
    )
  }
  return invalid.length > 0 || grown.length > 0 || shrunk.length > 0 ? 1 : 0
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = main(process.argv.slice(2))
}
