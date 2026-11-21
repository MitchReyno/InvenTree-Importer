import type { Pool } from 'pg'
import type { BlobStore } from '#/media/blob-store.ts'
import { mediaContent } from '#/media/content.ts'
import type { ProcessingConfig } from '#/processing/attempts.ts'
import { researchAttemptAccess } from '#/processing/research.ts'
import { researchBroker, type ResearchBrokerFactory } from './broker.ts'
import { researchReceiptStore } from './receipts.ts'
import type { ResearchInventoryRead } from './inventory.ts'
import type { SourceResolver } from './source-policy.ts'
import type { SourceTransport } from './source-fetch.ts'
import { assertResearchActive } from './errors.ts'

export interface ResearchBrokerServices {
  pool: Pool
  config: ProcessingConfig
  mediaStore: BlobStore
  readInventory: ResearchInventoryRead
  resolveSource?: SourceResolver
  sourceTransport?: SourceTransport
}

/** Explicit fixture composition only. Constructing this factory never launches a provider or worker. */
export function createResearchBrokerFactory(
  services: ResearchBrokerServices,
): ResearchBrokerFactory {
  const content = mediaContent(services.pool, services.config, services.mediaStore)

  return async (input, signal) => {
    assertResearchActive(signal)
    const access = await researchAttemptAccess(services.pool, services.config, input)
    assertResearchActive(signal)
    return researchBroker({
      access,
      receipts: researchReceiptStore(services.pool, access.scope),
      readEvidence: (versionId) => content.original(access.scope.batchId, versionId),
      readInventory: services.readInventory,
      protectedOrigins: services.config.sourceProtectedOrigins ?? [],
      resolveSource: services.resolveSource,
      sourceTransport: services.sourceTransport,
    })
  }
}
