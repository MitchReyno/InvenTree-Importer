#!/usr/bin/env node
// Owned CLI fixture: no Docker daemon, SQL or inventory transport is available.
import { appendFileSync } from 'node:fs'
const args = process.argv.slice(2)
appendFileSync(process.env.INTAKE_FIXTURE_CALLS!, `${JSON.stringify(args)}\n`)
if (args[0] === 'ps') process.stdout.write(JSON.stringify({ Names: 'bench-intake-dev-pg', Image: 'postgres:17', Status: 'Up', Ports: 'fixture-only' }))
else if (args[0] === 'compose') process.stdout.write('NAME STATUS\n')
else if (args[0] === 'inspect') process.stdout.write(JSON.stringify([{ Config: { Labels: { 'bench-intake.owner': 'T01' }, Image: 'postgres:17' }, HostConfig: { PortBindings: { '5432/tcp': [{ HostIp: '0.0.0.0', HostPort: '55432' }] } } }]))
else { process.stderr.write('Unexpected effect attempted by service command\n'); process.exitCode = 1 }
