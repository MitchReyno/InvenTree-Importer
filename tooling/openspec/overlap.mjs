#!/usr/bin/env node
// Checks that syncing one OpenSpec change cannot overwrite or contradict another
// change's pending deltas or silently collide with the main specs.
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const OPERATIONS = ['ADDED', 'MODIFIED', 'REMOVED', 'RENAMED']

export function parseRequirements(text) {
  return [...text.matchAll(/^### Requirement:\s*(.+?)\s*$/gm)].map((m) => m[1])
}

export function parseDelta(text) {
  const delta = Object.fromEntries(OPERATIONS.map((op) => [op, []]))
  let current = null
  for (const line of text.split('\n')) {
    const section = line.match(/^## (ADDED|MODIFIED|REMOVED|RENAMED) Requirements\s*$/)
    if (section) {
      current = section[1]
      continue
    }
    if (/^## /.test(line)) current = null
    if (!current) continue
    const requirement = line.match(/^### Requirement:\s*(.+?)\s*$/)
    if (requirement && current !== 'RENAMED') delta[current].push(requirement[1])
    const renamed = line.match(/^\s*-\s*(FROM|TO):\s*`?(?:### Requirement:\s*)?(.+?)`?\s*$/)
    if (renamed && current === 'RENAMED') delta.RENAMED.push(`${renamed[1]}:${renamed[2]}`)
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
  for (const entry of existsSync(changesDir)
    ? readdirSync(changesDir, { withFileTypes: true })
    : []) {
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

export function checkOverlap({ main, changes }, name, { newCapabilitiesOnly = false } = {}) {
  const deltas = changes[name]
  if (!deltas) return { errors: [`no active change named ${name}`], warnings: [] }
  const errors = []
  const warnings = []
  for (const [cap, delta] of Object.entries(deltas)) {
    const existing = main[cap] ?? []
    const others = Object.entries(changes).filter(([other, specs]) => other !== name && specs[cap])
    if (newCapabilitiesOnly && cap in main) {
      errors.push(
        `${cap}: exists in openspec/specs, but --new-capabilities-only allows only new capabilities`,
      )
    }
    for (const [other] of others) {
      const message = `${cap}: also changed by active change ${other}; sync order decides which wins`
      ;(newCapabilitiesOnly ? errors : warnings).push(message)
    }
    for (const requirement of delta.ADDED) {
      if (existing.includes(requirement)) {
        errors.push(`${cap}: ADDED "${requirement}" already exists in the main spec`)
      }
      for (const [other, specs] of others) {
        if (specs[cap].ADDED.includes(requirement)) {
          errors.push(`${cap}: "${requirement}" is also ADDED by ${other}`)
        }
      }
    }
    for (const op of ['MODIFIED', 'REMOVED']) {
      for (const requirement of delta[op]) {
        if (!existing.includes(requirement)) {
          errors.push(`${cap}: ${op} "${requirement}" is not in the main spec`)
        }
        for (const [other, specs] of others) {
          if (
            specs[cap].MODIFIED.includes(requirement) ||
            specs[cap].REMOVED.includes(requirement)
          ) {
            errors.push(`${cap}: "${requirement}" is also modified or removed by ${other}`)
          }
        }
      }
    }
  }
  return { errors, warnings }
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
  for (const warning of result.warnings) console.log(`warning: ${warning}`)
  for (const error of result.errors) console.error(`error: ${error}`)
  if (!result.errors.length)
    console.log(`${name}: no sync conflicts with the main specs or other active changes`)
  return result.errors.length ? 1 : 0
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = main(process.argv)
}
