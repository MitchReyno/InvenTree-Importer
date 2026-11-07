#!/usr/bin/env node
// Checks that syncing one OpenSpec change cannot overwrite or contradict another
// change's pending deltas or silently collide with the main specs. Specs and
// deltas are parsed with the installed OpenSpec CLI's own parser, and each delta
// is simulated in the CLI's apply order, so "already applied" and "conflict"
// mean what they mean to `openspec` sync.
import { existsSync, readdirSync, readFileSync, realpathSync, statSync } from 'node:fs'
import { delimiter, dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const QUALIFIED = '1.16.0'
const PARSER = 'dist/core/parsers/requirement-blocks.js'
const EXPORTS = [
  'parseDeltaSpec',
  'extractRequirementsSection',
  'normalizeRequirementName',
  'foldRequirementName',
  'diffScenarioNames',
]
const unavailable = (detail) =>
  new Error(
    `OpenSpec CLI parser unavailable (${detail}). Install @fission-ai/openspec@${QUALIFIED}, ` +
      'or set OPENSPEC_CLI_DIR to its package directory.',
  )

/**
 * The installed CLI's package root: OPENSPEC_CLI_DIR, else found from an
 * `openspec` executable or npm shim on PATH (symlinked, or a Windows shim next
 * to `node_modules`).
 */
export function cliRoot(env = process.env) {
  if (env.OPENSPEC_CLI_DIR) return resolve(env.OPENSPEC_CLI_DIR)
  for (const dir of (env.PATH ?? '').split(delimiter)) {
    for (const bin of ['openspec', 'openspec.cmd', 'openspec.ps1'].map((name) => join(dir, name))) {
      if (!existsSync(bin)) continue
      const candidates = [
        dirname(dirname(realpathSync(bin))),
        join(dir, 'node_modules/@fission-ai/openspec'),
        join(dir, '../lib/node_modules/@fission-ai/openspec'),
      ]
      const found = candidates.find((candidate) => existsSync(join(candidate, PARSER)))
      if (found) return found
    }
  }
  throw unavailable('no openspec installation found on PATH')
}

async function loadParser() {
  const root = cliRoot()
  if (!existsSync(join(root, PARSER))) throw unavailable(`${PARSER} missing under ${root}`)
  const module = await import(pathToFileURL(join(root, PARSER)).href)
  const missing = EXPORTS.filter((name) => typeof module[name] !== 'function')
  if (missing.length) throw unavailable(`missing exports ${missing.join(', ')}`)
  const version = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).version
  return { module, version }
}

const { module: parser, version } = await loadParser()
export const cliVersion = version
const {
  parseDeltaSpec,
  extractRequirementsSection,
  normalizeRequirementName,
  foldRequirementName,
  diffScenarioNames,
} = parser
// The CLI's normalizeBlockRaw: only line endings and outer whitespace.
const normalizeBlock = (raw) => raw.replace(/\r\n?/g, '\n').trim()

/** Main spec requirements, keyed by the CLI's normalized name. */
export function parseRequirements(text) {
  return new Map(
    extractRequirementsSection(text).bodyBlocks.map((block) => [
      normalizeRequirementName(block.name),
      block.raw,
    ]),
  )
}

/** A delta parsed by the CLI, plus the problems its pre-validation rejects. */
export function parseDelta(text) {
  const plan = parseDeltaSpec(text)
  const problems = []
  const unique = (op, names) => {
    const seen = new Set()
    for (const name of names) {
      if (seen.has(name)) problems.push(`duplicate requirement in ${op} "${name}"`)
      seen.add(name)
    }
    return seen
  }
  const delta = {
    ADDED: plan.added.map((b) => ({ name: normalizeRequirementName(b.name), raw: b.raw })),
    MODIFIED: plan.modified.map((b) => ({ name: normalizeRequirementName(b.name), raw: b.raw })),
    REMOVED: plan.removed.map((name) => normalizeRequirementName(name)),
    RENAMED: plan.renamed.map(({ from, to }) => ({
      from: normalizeRequirementName(from),
      to: normalizeRequirementName(to),
    })),
    problems,
  }
  const added = unique(
    'ADDED',
    delta.ADDED.map((b) => b.name),
  )
  const modified = unique(
    'MODIFIED',
    delta.MODIFIED.map((b) => b.name),
  )
  const removed = unique('REMOVED', delta.REMOVED)
  unique(
    'RENAMED FROM',
    delta.RENAMED.map((r) => r.from),
  )
  unique(
    'RENAMED TO',
    delta.RENAMED.map((r) => r.to),
  )
  for (const { side, name } of plan.unpairedRenames) {
    problems.push(`unpaired RENAMED ${side} "${name}"`)
  }
  const operations =
    delta.ADDED.length + delta.MODIFIED.length + delta.REMOVED.length + delta.RENAMED.length
  if (operations === 0) problems.push('no ADDED, MODIFIED, REMOVED or RENAMED operations parsed')
  for (const n of modified) {
    if (removed.has(n)) problems.push(`"${n}" is both MODIFIED and REMOVED`)
    if (added.has(n)) problems.push(`"${n}" is both MODIFIED and ADDED`)
  }
  for (const n of added) if (removed.has(n)) problems.push(`"${n}" is both ADDED and REMOVED`)
  for (const { from, to } of delta.RENAMED) {
    if ([...removed].some((r) => foldRequirementName(r) === foldRequirementName(from))) {
      problems.push(`"${from}" is both RENAMED and REMOVED`)
    }
    if (modified.has(from))
      problems.push(`MODIFIED must use the new name "${to}" of renamed "${from}"`)
    if (added.has(to)) problems.push(`RENAMED destination "${to}" collides with ADDED`)
  }
  return delta
}

/**
 * Capability IDs (relative paths, nested included) as the CLI's
 * discoverSpecFiles finds them: dot entries are skipped, symlinked directories
 * are not followed, and spec.md must be a file or a symlink to one.
 */
function capabilityDirs(dir, prefix = '') {
  if (!existsSync(dir)) return []
  const found = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.startsWith('.')) continue
    if (entry.isDirectory()) {
      found.push(
        ...capabilityDirs(join(dir, entry.name), prefix ? `${prefix}/${entry.name}` : entry.name),
      )
    } else if (entry.name === 'spec.md' && prefix) {
      const file = join(dir, entry.name)
      if (
        entry.isFile() ||
        (entry.isSymbolicLink() && statSync(file, { throwIfNoEntry: false })?.isFile())
      ) {
        found.push(prefix)
      }
    }
  }
  return found
}

export function loadWorkspace(workspaceRoot) {
  const specsDir = join(workspaceRoot, 'openspec/specs')
  const main = Object.fromEntries(
    capabilityDirs(specsDir).map((cap) => [
      cap,
      parseRequirements(readFileSync(join(specsDir, cap, 'spec.md'), 'utf8')),
    ]),
  )
  const changesDir = join(workspaceRoot, 'openspec/changes')
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

/** Every name a delta mentions, used when its problems prevent simulation. */
function namesIn(delta) {
  const names = new Set([
    ...delta.ADDED.map((b) => b.name),
    ...delta.MODIFIED.map((b) => b.name),
    ...delta.REMOVED,
  ])
  for (const { from, to } of delta.RENAMED) names.add(from).add(to)
  return names
}

/**
 * Simulates one capability delta against the main spec in the CLI's apply order
 * (renamed, removed, modified, added). Returns what it would change (pending),
 * what is already in the main spec (applied), and what the CLI would reject.
 */
export function classifyDelta(cap, delta, existing) {
  const result = { pending: new Set(), applied: [], errors: [], warnings: [] }
  if (delta.problems.length) {
    result.errors.push(...delta.problems.map((problem) => `${cap}: ${problem}`))
    result.pending = namesIn(delta)
    return result
  }
  const working = new Map(existing)
  const nearMiss = (name, except) =>
    [...working.keys()].find(
      (k) => k !== except && foldRequirementName(k) === foldRequirementName(name),
    )
  for (const { from, to } of delta.RENAMED) {
    if (!working.has(from)) {
      if (working.has(to) && nearMiss(from, to) === undefined) {
        result.applied.push(`${cap}: RENAMED "${from}" to "${to}"`)
      } else {
        result.errors.push(`${cap}: RENAMED "${from}" is not in the main spec`)
      }
    } else if (working.has(to) || nearMiss(to, from) !== undefined) {
      result.errors.push(`${cap}: RENAMED destination "${to}" already exists in the main spec`)
    } else {
      const lines = working.get(from).split('\n')
      lines[0] = `### Requirement: ${to}`
      working.delete(from)
      working.set(to, lines.join('\n'))
      result.pending.add(from).add(to)
    }
  }
  for (const name of delta.REMOVED) {
    if (working.delete(name)) result.pending.add(name)
    else if (nearMiss(name) !== undefined) {
      result.errors.push(
        `${cap}: REMOVED "${name}" is not in the main spec, but a near-miss spelling is`,
      )
    } else {
      result.warnings.push(`${cap}: REMOVED "${name}" is not in the main spec (already removed)`)
    }
  }
  for (const { name, raw } of delta.MODIFIED) {
    const current = working.get(name)
    if (current === undefined) {
      result.errors.push(`${cap}: MODIFIED "${name}" is not in the main spec`)
      continue
    }
    const { missing } = diffScenarioNames({ raw: current }, { raw })
    if (missing.length) {
      result.errors.push(
        `${cap}: MODIFIED "${name}" drops current scenario(s): ${missing.join(', ')}`,
      )
    }
    if (normalizeBlock(current) === normalizeBlock(raw))
      result.applied.push(`${cap}: MODIFIED "${name}"`)
    else result.pending.add(name)
    working.set(name, raw)
  }
  for (const { name, raw } of delta.ADDED) {
    const current = working.get(name)
    if (current !== undefined) {
      if (normalizeBlock(current) === normalizeBlock(raw))
        result.applied.push(`${cap}: ADDED "${name}"`)
      else
        result.errors.push(
          `${cap}: ADDED "${name}" differs from the main spec requirement of that name`,
        )
    } else if (nearMiss(name) !== undefined) {
      result.errors.push(
        `${cap}: ADDED "${name}" differs only in case or spacing from "${nearMiss(name)}"`,
      )
    } else {
      result.pending.add(name)
      working.set(name, raw)
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
        if ([...pending].some((p) => foldRequirementName(p) === foldRequirementName(requirement))) {
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
  const workspaceRoot = resolve(rootIndex >= 0 ? args[rootIndex + 1] : process.cwd())
  const result = checkOverlap(loadWorkspace(workspaceRoot), name, {
    newCapabilitiesOnly: args.includes('--new-capabilities-only'),
  })
  console.log(`parsed with OpenSpec ${cliVersion}`)
  if (result.applied.length) {
    console.log(`${result.applied.length} delta operation(s) already applied to the main specs`)
  }
  for (const warning of result.warnings) console.log(`warning: ${warning}`)
  for (const error of result.errors) console.error(`error: ${error}`)
  if (!result.errors.length) {
    console.log(`${name}: no sync conflicts with the main specs or other active changes`)
  }
  return result.errors.length ? 1 : 0
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = main(process.argv)
}
