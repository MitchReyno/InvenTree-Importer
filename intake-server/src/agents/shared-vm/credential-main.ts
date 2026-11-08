import { readFileSync } from 'node:fs'
import { managementServer } from './credential-http.ts'

import { CodexAccount } from './codex-login.ts'
import { providerProxy } from './provider-proxy.ts'

process.umask(0o077)
const key = readFileSync('/run/operator/key', 'utf8').trim()
const codex = process.env.INTAKE_VM_CODEX_SUBSCRIPTION === '1'
if (codex) {
  await providerProxy('codex')
}
managementServer(
  '/run/claude-store',
  process.env.INTAKE_OPERATOR_ORIGIN ?? '',
  key,
  codex ? new CodexAccount('/run/codex-state') : undefined,
).listen(codex ? 14317 : 14315, '0.0.0.0')
