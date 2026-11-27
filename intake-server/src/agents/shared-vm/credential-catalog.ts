// Wires a credential process's sign-in into its model catalogue endpoint (`model-catalog.ts`).
import { mkdtemp, rm } from 'node:fs/promises'
import { readClaudeCliModels } from '#/agents/model-catalog/cli-readers.ts'
import { CatalogReadError } from '#/agents/model-catalog/normalise.ts'
import { readClaudeStatus, readClaudeToken } from './claude-credential.ts'
import type { CodexAccount } from './codex-login.ts'
import { pairing } from './pair.ts'
import { serveModelCatalog, type GuestCatalogReader } from './model-catalog.ts'
import type { StatusProvider } from './provider-status.ts'

/** The loopback proxy to this provider's Anthropic-only egress socket (`provider-proxy.ts`). */
const PROVIDER_PROXY = 'http://127.0.0.1:14316'

/**
 * Claude's list from the pinned CLI's `initialize`, with the saved token and the egress a turn
 * uses. Its generation is the token store's revision; a read across a change is discarded.
 */
export function claudeCatalogReader(
  storeDirectory: string,
  executable = 'claude',
  scratch = '/tmp',
): GuestCatalogReader {
  return {
    generation: async () => readClaudeStatus(storeDirectory).revision,
    async read(signal) {
      const before = readClaudeStatus(storeDirectory)
      const token = before.configured ? readClaudeToken(storeDirectory) : undefined
      if (!token) {
        throw new CatalogReadError('signed_out')
      }
      // A fresh home, so no settings, hooks or session files from another read or turn apply.
      const home = await mkdtemp(`${scratch}/model-catalog-`)
      try {
        const answer = await readClaudeCliModels(
          executable,
          home,
          {
            PATH: process.env.PATH,
            HOME: home,
            CLAUDE_CODE_OAUTH_TOKEN: token,
            HTTPS_PROXY: PROVIDER_PROXY,
            NO_PROXY: 'localhost,127.0.0.1,::1',
          },
          signal,
        )
        if (readClaudeStatus(storeDirectory).revision !== before.revision) {
          throw new CatalogReadError('unavailable')
        }
        return { generation: before.revision, ...answer }
      } finally {
        await rm(home, { recursive: true, force: true })
      }
    },
  }
}

/** Codex's list from app-server `model/list`, under the shared account lock turns take. */
export function codexCatalogReader(account: CodexAccount): GuestCatalogReader {
  return {
    generation: () => account.signInGeneration(),
    read: (signal) => account.readModels(signal),
  }
}

/**
 * Starts the catalogue endpoint with the guest pairing identity. A container provisioned without
 * that identity keeps serving credential management; its list then reads as unavailable.
 */
export async function startCatalogService(
  provider: StatusProvider,
  reader: GuestCatalogReader,
  pairDirectory: string,
  socketPath: string,
) {
  let identity: Awaited<ReturnType<typeof pairing>>
  try {
    identity = await pairing(pairDirectory)
  } catch {
    process.stderr.write('model_catalog_unavailable\n')
    return undefined
  }
  return serveModelCatalog({ provider, pairing: identity, socketPath, reader })
}
