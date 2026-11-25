// Claude's model catalogue service. It runs in a container of its own with no network, like a
// turn's, so the CLI a read starts reaches only the Anthropic-only egress socket, never the
// management container's network.
import { providerProxy } from './provider-proxy.ts'
import { claudeCatalogReader, startCatalogService } from './credential-catalog.ts'
import { CATALOG_SOCKET } from './model-catalog.ts'

process.umask(0o077)
await providerProxy('claude')
await startCatalogService(
  'claude',
  claudeCatalogReader('/run/claude-store'),
  '/run/bench-pair',
  CATALOG_SOCKET,
)
