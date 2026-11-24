// Wires a credential process's state into its status-only endpoint (`provider-status.ts`).
import { readClaudeStatus } from './claude-credential.ts'
import type { CodexAccount } from './codex-login.ts'
import { pairing } from './pair.ts'
import {
  serveProviderStatus,
  type GuestProviderStatus,
  type StatusProvider,
  type StatusReader,
} from './provider-status.ts'

/** Claude's answer from a read-only connection to the token store. */
export function claudeStatusReader(directory: string) {
  return async (): Promise<GuestProviderStatus> => {
    const status = readClaudeStatus(directory)
    if (status.configured) {
      return {
        provider: 'claude',
        state: 'saved',
        revision: status.revision,
        saved_at: status.saved_at,
      }
    }
    return { provider: 'claude', state: 'not_saved', revision: status.revision }
  }
}

/**
 * Codex's answer, read without changing a sign-in. It comes at once from the last check, which
 * runs apart from the request: the request's signal only keeps an ended request from starting one.
 */
export function codexStatusReader(account: CodexAccount): StatusReader {
  return async (signal, refresh) => {
    const status = await account.readStatus(refresh, signal)
    switch (status.state) {
      case 'signed_in':
      case 'signed_out':
      case 'signing_in':
        return {
          provider: 'codex',
          state: status.state,
          age_ms: Math.round(status.ageMs),
          refreshing: status.refreshing,
        }
      case 'checking':
      case 'busy':
      case 'timeout':
      case 'unavailable':
        return { provider: 'codex', state: status.state }
    }
  }
}

/**
 * Starts the status endpoint with the guest pairing identity. A container provisioned without
 * that identity keeps serving credential management; its provider then reads as unavailable.
 */
export async function startStatusService(
  provider: StatusProvider,
  read: StatusReader,
  pairDirectory: string,
  socketPath: string,
) {
  let identity: Awaited<ReturnType<typeof pairing>>
  try {
    identity = await pairing(pairDirectory)
  } catch {
    process.stderr.write('provider_status_unavailable\n')
    return undefined
  }
  return serveProviderStatus({ provider, pairing: identity, socketPath, read })
}
