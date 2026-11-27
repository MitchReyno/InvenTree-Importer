#!/usr/bin/env node
// Owned CLI fixture: no Docker daemon, SQL or inventory transport is available.
// INTAKE_FIXTURE_SCENARIO names a JSON file: { containers, volumes, inspect, fail }.
import { appendFileSync, readFileSync } from 'node:fs'

interface Scenario {
  containers?: Record<string, unknown>[]
  volumes?: Record<string, unknown>[]
  inspect?: Record<string, unknown>
  fail?: string[]
}

const args = process.argv.slice(2)
appendFileSync(process.env.INTAKE_FIXTURE_CALLS!, `${JSON.stringify(args)}\n`)
const scenario: Scenario = process.env.INTAKE_FIXTURE_SCENARIO
  ? JSON.parse(readFileSync(process.env.INTAKE_FIXTURE_SCENARIO, 'utf8'))
  : {}
const command =
  args[0] === 'compose'
    ? `compose ${args.find((arg) => !arg.startsWith('-') && arg !== 'compose' && !arg.endsWith('.yaml') && arg !== 'bench-inventree-dev') ?? ''}`
    : args[0]

if (scenario.fail?.includes(command)) {
  process.stderr.write(`fixture failure for ${command}\n`)
  process.exitCode = 1
} else if (command === 'ps') {
  process.stdout.write((scenario.containers ?? []).map((row) => JSON.stringify(row)).join('\n'))
} else if (command === 'volume') {
  process.stdout.write((scenario.volumes ?? []).map((row) => JSON.stringify(row)).join('\n'))
} else if (command === 'inspect') {
  const found = scenario.inspect?.[args[args.length - 1]]
  if (found) {
    process.stdout.write(JSON.stringify([found]))
  } else {
    process.exitCode = 1
  }
} else if (command === 'compose ls') {
  process.stdout.write('NAME STATUS\n')
} else if (command.startsWith('compose ')) {
  // up/rm/cp/stop and friends: record only.
} else {
  process.stderr.write('Unexpected effect attempted by service command\n')
  process.exitCode = 1
}
