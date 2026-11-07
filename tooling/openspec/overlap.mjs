#!/usr/bin/env node
// Checks that syncing one OpenSpec change cannot overwrite or contradict another
// change's pending deltas or silently collide with the main specs. A delta whose
// result is already in the main spec counts as applied, not as a conflict.
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const OPERATIONS = ['ADDED', 'MODIFIED', 'REMOVED', 'RENAMED']
// Matches OpenSpec 1.16.0's normalizeBlockRaw: only line endings and outer whitespace.
const normalize = (text) => text.replace(/\r\n?/g, '\n').trim()

/** Lists [name, block] pairs in order; a `## ` heading ends the current block. */
function parseBlocks(text) {
  const blocks = []
  let name = null
  let lines = []
  const flush = () => {
    if (name !== null) blocks.push([name, normalize(lines.join('\n'))])
  }
  for (const line of text.replace(/\r\n?/g, '\n').split('\n')) {
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

/** Maps each requirement name to its block text. */
export function parseRequirements(text) {
  return new Map(parseBlocks(text))
}

/**
 * Parses a delta and records the structural problems OpenSpec rejects before
 * applying: duplicate names within a section and contradictory sections.
 */
export function parseDelta(text) {
  const delta = {
    ADDED: new Map(),
    MODIFIED: new Map(),
    REMOVED: new Map(),
    RENAMED: [],
    problems: [],
  }
  for (const section of text.replace(/\r\n?/g, '\n').split(/^(?=## )/m)) {
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
      continue
    }
    for (const [name, block] of parseBlocks(section)) {
      if (delta[op].has(name)) delta.problems.push(`duplicate requirement in ${op} "${name}"`)
      else delta[op].set(name, block)
    }
  }
  const froms = new Set()
  const tos = new Set()
  for (const { from, to } of delta.RENAMED) {
    if (froms.has(from)) delta.problems.push(`duplicate FROM in RENAMED "${from}"`)
    if (tos.has(to)) delta.problems.push(`duplicate TO in RENAMED "${to}"`)
    froms.add(from)
    tos.add(to)
  }
  const both = (a, b) => [...delta[a].keys()].filter((n) => delta[b].has(n))
  for (const n of both('MODIFIED', 'REMOVED'))
    delta.problems.push(`"${n}" is both MODIFIED and REMOVED`)
  for (const n of both('MODIFIED', 'ADDED'))
    delta.problems.push(`"${n}" is both MODIFIED and ADDED`)
  for (const n of both('ADDED', 'REMOVED')) delta.problems.push(`"${n}" is both ADDED and REMOVED`)
  for (const { from, to } of delta.RENAMED) {
    if (delta.REMOVED.has(from)) delta.problems.push(`"${from}" is both RENAMED and REMOVED`)
    if (delta.MODIFIED.has(from)) {
      delta.problems.push(`MODIFIED must use the new name "${to}" of renamed "${from}"`)
    }
    if (delta.ADDED.has(to)) delta.problems.push(`RENAMED destination "${to}" collides with ADDED`)
  }
  return delta
}

/** Every name a delta mentions, used when its problems prevent classification. */
function namesIn(delta) {
  const names = new Set([...delta.ADDED.keys(), ...delta.MODIFIED.keys(), ...delta.REMOVED.keys()])
  for (const { from, to } of delta.RENAMED) names.add(from).add(to)
  return names
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

/**
 * Classifies one capability delta against the main spec in OpenSpec's apply
 * order (renamed, removed, modified, added), so later operations see earlier
 * renames. Returns the names its pending operations touch.
 */
export function classifyDelta(cap, delta, existing) {
  const result = { pending: new Set(), applied: [], errors: [], warnings: [] }
  if (delta.problems.length) {
    result.errors.push(...delta.problems.map((problem) => `${cap}: ${problem}`))
    result.pending = namesIn(delta)
    return result
  }
  const working = new Map(existing)
  for (const { from, to } of delta.RENAMED) {
    const hasFrom = working.has(from)
    const hasTo = working.has(to)
    if (hasFrom && hasTo) {
      result.errors.push(`${cap}: RENAMED "${from}" to "${to}", but both exist in the main spec`)
    } else if (hasFrom) {
      working.set(to, working.get(from))
      working.delete(from)
      result.pending.add(from).add(to)
    } else if (hasTo) {
      result.applied.push(`${cap}: RENAMED "${from}" to "${to}"`)
    } else {
      result.errors.push(`${cap}: RENAMED "${from}" is not in the main spec`)
    }
  }
  for (const requirement of delta.REMOVED.keys()) {
    if (working.delete(requirement)) result.pending.add(requirement)
    else {
      result.warnings.push(
        `${cap}: REMOVED "${requirement}" is not in the main spec (already removed, or misnamed)`,
      )
    }
  }
  for (const [requirement, block] of delta.MODIFIED) {
    if (!working.has(requirement)) {
      result.errors.push(`${cap}: MODIFIED "${requirement}" is not in the main spec`)
    } else if (working.get(requirement) === block) {
      result.applied.push(`${cap}: MODIFIED "${requirement}"`)
    } else result.pending.add(requirement)
  }
  for (const [requirement, block] of delta.ADDED) {
    if (!working.has(requirement)) result.pending.add(requirement)
    else if (working.get(requirement) === block) {
      result.applied.push(`${cap}: ADDED "${requirement}"`)
    } else {
      result.errors.push(
        `${cap}: ADDED "${requirement}" differs from the main spec requirement of that name`,
      )
    }
  }
  return result
}

export function checkOverlap({ main, changes }, name, { newCapabilitiesOnly = false } = {}) {
  const deltas = changes[name]
  if (!deltas) return { errors: [`no active change named ${name}`], warnings: [], applied: [] }
  const errors = []
  const warnings = []
  const applied = []
  for (const [cap, delta] of Object.entries(deltas)) {
    const existing = main[cap] ?? new Map()
    const own = classifyDelta(cap, delta, existing)
    errors.push(...own.errors)
    warnings.push(...own.warnings)
    applied.push(...own.applied)
    // Only another change's pending operations can conflict; an already-synced
    // but unarchived change no longer competes for its requirements.
    const others = Object.entries(changes)
      .filter(([other, specs]) => other !== name && specs[cap])
      .map(([other, specs]) => [other, classifyDelta(cap, specs[cap], existing).pending])
      .filter(([, pending]) => pending.size > 0)
    for (const [other, pending] of others) {
      for (const requirement of own.pending) {
        if (pending.has(requirement)) {
          errors.push(`${cap}: "${requirement}" is also changed by ${other}`)
        }
      }
    }
    if (newCapabilitiesOnly && cap in main && own.pending.size > 0) {
      errors.push(
        `${cap}: exists in openspec/specs, but --new-capabilities-only allows only new capabilities`,
      )
    }
    if (own.pending.size > 0) {
      for (const [other] of others) {
        const message = `${cap}: also changed by active change ${other}; sync order decides which wins`
        ;(newCapabilitiesOnly ? errors : warnings).push(message)
      }
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
