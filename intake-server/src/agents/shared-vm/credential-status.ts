// Wires a credential process's state into its status-only endpoint (`provider-status.ts`).
import { readClaudeStatus } from './claude-credential.ts'
import type { CodexAccount } from './codex-login.ts'
import { pairing } from './pair.ts'
import {
  serveProviderStatus,
  type GuestProviderStatus,
  type StatusProvider,
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

/** Codex's answer, read without changing a sign-in. */
export function codexStatusReader(account: CodexAccount) {
  return async (signal: AbortSignal): Promise<GuestProviderStatus> => ({
    provider: 'codex',
    state: await account.readStatus(signal),
  })
}

/**
 * Starts the status endpoint with the guest pairing identity. A container provisioned without
 * that identity keeps serving credential management; its provider then reads as unavailable.
 */
export async function startStatusService(
  provider: StatusProvider,
  read: (signal: AbortSignal) => Promise<GuestProviderStatus>,
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
