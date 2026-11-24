import { readFileSync } from 'node:fs'
import { managementServer } from './credential-http.ts'

import { CodexAccount } from './codex-login.ts'
import { providerProxy } from './provider-proxy.ts'
import { claudeStatusReader, codexStatusReader, startStatusService } from './credential-status.ts'
import { STATUS_SOCKET } from './provider-status.ts'

process.umask(0o077)
const key = readFileSync('/run/operator/key', 'utf8').trim()
const codex = process.env.INTAKE_VM_CODEX_SUBSCRIPTION === '1'
const account = codex ? new CodexAccount('/run/codex-state') : undefined
if (codex) {
  await providerProxy('codex')
}
managementServer(
  '/run/claude-store',
  process.env.INTAKE_OPERATOR_ORIGIN ?? '',
  key,
  account,
).listen(codex ? 14317 : 14315, '0.0.0.0')
// After the management server, which creates the Claude store the status reads.
await startStatusService(
  codex ? 'codex' : 'claude',
  account ? codexStatusReader(account) : claudeStatusReader('/run/claude-store'),
  '/run/bench-pair',
  STATUS_SOCKET,
)
