import type { PoolClient } from 'pg'
import type {
  ProcessingInputDto,
  ProcessingProposalDto,
  ResearchReceiptSourceDto,
} from '@invimport/contracts'
import type { CaptureBinding } from '#/capture/model.ts'
import { verifyResearchReceiptSources } from '#/research/receipts.ts'
import { fail } from './model.ts'

export async function verifyRetainedResearchSources(
  client: PoolClient,
  binding: CaptureBinding,
  manifest: ProcessingInputDto,
  producer: { attemptId: string; commandId: string; inputSha256: string },
  proposal: ProcessingProposalDto,
) {
  if (!('sources' in proposal)) {
    return
  }
  const sources: ResearchReceiptSourceDto[] = []
  for (const source of proposal.sources) {
    if (source.kind === 'research_receipt') {
      sources.push(source)
    }
  }
  if (sources.length === 0) {
    return
  }
  if (manifest.schema_version !== 'bench-intake-input/3') {
    fail('runner_source_version_mismatch', 422)
  }
  await verifyResearchReceiptSources(
    client,
    {
      ...binding,
      batchId: manifest.batch_id,
      attemptId: producer.attemptId,
      commandId: producer.commandId,
      inputSha256: producer.inputSha256,
      sourceUrls: manifest.source_urls,
    },
    sources,
  )
}
