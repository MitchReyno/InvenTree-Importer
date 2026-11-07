#!/usr/bin/env node
// Checks that syncing one OpenSpec change cannot overwrite or contradict another
// change's pending deltas or silently collide with the main specs. A delta whose
// result is already in the main spec counts as applied, not as a conflict.
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const OPERATIONS = ['ADDED', 'MODIFIED', 'REMOVED', 'RENAMED']
const normalize = (text) => text.replace(/\s+/g, ' ').trim()

/** Maps each requirement name to its normalized block text. */
export function parseRequirements(text) {
  const blocks = new Map()
  let name = null
  let lines = []
  const flush = () => {
    if (name !== null) blocks.set(name, normalize(lines.join('\n')))
  }
  for (const line of text.split('\n')) {
    const heading = line.match(/^### Requirement:\s*(.+?)\s*$/)
    if (heading || /^## /.test(line)) {
      flush()
      name = heading ? heading[1] : null
      lines = []
      continue
    }
    if (name !== null) lines.push(line)
  }
  flush()
  return blocks
}

export function parseDelta(text) {
  const delta = { ADDED: new Map(), MODIFIED: new Map(), REMOVED: new Map(), RENAMED: [] }
  const sections = text.split(/^(?=## )/m)
  for (const section of sections) {
    const op = section.match(/^## (ADDED|MODIFIED|REMOVED|RENAMED) Requirements\s*$/m)?.[1]
    if (!op) continue
    if (op === 'RENAMED') {
      let from = null
      for (const line of section.split('\n')) {
        const entry = line.match(/^\s*-\s*(FROM|TO):\s*`?(?:### Requirement:\s*)?(.+?)`?\s*$/)
        if (!entry) continue
        if (entry[1] === 'FROM') from = entry[2]
        else if (from !== null) {
          delta.RENAMED.push({ from, to: entry[2] })
          from = null
        }
      }
    } else {
      delta[op] = parseRequirements(section.replace(/^## .*$/m, '## x'))
    }
  }
  return delta
}

function capabilityDirs(dir) {
  if (!existsSync(dir)) return []
  return readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && existsSync(join(dir, entry.name, 'spec.md')))
    .map((entry) => entry.name)
}

export function loadWorkspace(root) {
  const specsDir = join(root, 'openspec/specs')
  const main = Object.fromEntries(
    capabilityDirs(specsDir).map((cap) => [
      cap,
      parseRequirements(readFileSync(join(specsDir, cap, 'spec.md'), 'utf8')),
    ]),
  )
  const changesDir = join(root, 'openspec/changes')
  const changes = {}
  const entries = existsSync(changesDir) ? readdirSync(changesDir, { withFileTypes: true }) : []
  for (const entry of entries) {
    if (!entry.isDirectory() || entry.name === 'archive') continue
    const specs = join(changesDir, entry.name, 'specs')
    changes[entry.name] = Object.fromEntries(
      capabilityDirs(specs).map((cap) => [
        cap,
        parseDelta(readFileSync(join(specs, cap, 'spec.md'), 'utf8')),
      ]),
    )
  }
  return { main, changes }
}

/** Names another change adds, edits, removes or renames in the same capability. */
function touchedBy(delta) {
  const touched = new Set([
    ...delta.ADDED.keys(),
    ...delta.MODIFIED.keys(),
    ...delta.REMOVED.keys(),
  ])
  for (const { from, to } of delta.RENAMED) touched.add(from).add(to)
  return touched
}

export function checkOverlap({ main, changes }, name, { newCapabilitiesOnly = false } = {}) {
  const deltas = changes[name]
  if (!deltas) return { errors: [`no active change named ${name}`], warnings: [], applied: [] }
  const errors = []
  const warnings = []
  const applied = []
  for (const [cap, delta] of Object.entries(deltas)) {
    const existing = main[cap] ?? new Map()
    const others = Object.entries(changes)
      .filter(([other, specs]) => other !== name && specs[cap])
      .map(([other, specs]) => [other, touchedBy(specs[cap])])
    const conflict = (requirement) => {
      for (const [other, touched] of others) {
        if (touched.has(requirement))
          errors.push(`${cap}: "${requirement}" is also changed by ${other}`)
      }
    }
    let pending = 0

    for (const [requirement, block] of delta.ADDED) {
      conflict(requirement)
      if (!existing.has(requirement)) pending++
      else if (existing.get(requirement) === block) applied.push(`${cap}: ADDED "${requirement}"`)
      else
        errors.push(
          `${cap}: ADDED "${requirement}" differs from the main spec requirement of that name`,
        )
    }
    for (const [requirement, block] of delta.MODIFIED) {
      conflict(requirement)
      if (!existing.has(requirement))
        errors.push(`${cap}: MODIFIED "${requirement}" is not in the main spec`)
      else if (existing.get(requirement) === block)
        applied.push(`${cap}: MODIFIED "${requirement}"`)
      else pending++
    }
    for (const requirement of delta.REMOVED.keys()) {
      conflict(requirement)
      if (existing.has(requirement)) pending++
      else
        warnings.push(
          `${cap}: REMOVED "${requirement}" is not in the main spec (already removed, or misnamed)`,
        )
    }
    for (const { from, to } of delta.RENAMED) {
      conflict(from)
      conflict(to)
      const hasFrom = existing.has(from)
      const hasTo = existing.has(to)
      if (hasFrom && hasTo)
        errors.push(`${cap}: RENAMED "${from}" to "${to}", but both exist in the main spec`)
      else if (hasFrom) pending++
      else if (hasTo) applied.push(`${cap}: RENAMED "${from}" to "${to}"`)
      else errors.push(`${cap}: RENAMED "${from}" is not in the main spec`)
    }

    if (newCapabilitiesOnly && cap in main && pending > 0) {
      errors.push(
        `${cap}: exists in openspec/specs, but --new-capabilities-only allows only new capabilities`,
      )
    }
    for (const [other] of others) {
      const message = `${cap}: also changed by active change ${other}; sync order decides which wins`
      ;(newCapabilitiesOnly ? errors : warnings).push(message)
    }
  }
  return { errors, warnings, applied }
}

function main(argv) {
  const args = argv.slice(2)
  const index = args.indexOf('--change')
  const name = index >= 0 ? args[index + 1] : undefined
  if (!name) {
    console.error('usage: overlap.mjs --change <name> [--new-capabilities-only] [--root <dir>]')
    return 2
  }
  const rootIndex = args.indexOf('--root')
  const root = resolve(rootIndex >= 0 ? args[rootIndex + 1] : process.cwd())
  const result = checkOverlap(loadWorkspace(root), name, {
    newCapabilitiesOnly: args.includes('--new-capabilities-only'),
  })
  if (result.applied.length)
    console.log(`${result.applied.length} delta operation(s) already applied to the main specs`)
  for (const warning of result.warnings) console.log(`warning: ${warning}`)
  for (const error of result.errors) console.error(`error: ${error}`)
  if (!result.errors.length)
    console.log(`${name}: no sync conflicts with the main specs or other active changes`)
  return result.errors.length ? 1 : 0
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = main(process.argv)
}
