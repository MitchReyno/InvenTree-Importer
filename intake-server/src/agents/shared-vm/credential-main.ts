import { readFileSync } from 'node:fs'
import { managementServer } from './credential-http.ts'

process.umask(0o077)
const key = readFileSync('/run/operator/key', 'utf8').trim()
managementServer('/run/claude-store', process.env.INTAKE_OPERATOR_ORIGIN ?? '', key).listen(
  14315,
  '0.0.0.0',
)
