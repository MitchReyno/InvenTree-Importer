import {
  Id,
  validate,
  type ResearchEvidenceReadDto,
  type ResearchInventoryLookupDto,
  type ResearchReceiptReadDto,
  type ResearchSourceFetchDto,
  type ResearchSourceChunkDto,
} from '@invimport/contracts'
import { canonical } from '@invimport/contracts/json'
import type { ResearchInput } from '../processing/runner.ts'
import type { ResearchAttemptAccess } from '../processing/research.ts'
import type { ResearchReceiptRepository } from './receipts.ts'
import { stagedEvidenceReader, researchChunk, type EvidenceByteReader } from './evidence.ts'
import { researchInventoryReader, type ResearchInventoryRead } from './inventory.ts'
import { sourceFetcher, type SourceTransport } from './source-fetch.ts'
import type { SourceResolver } from './source-policy.ts'
import { assertResearchActive, ResearchError, refuseResearch } from './errors.ts'
import {
  MAX_RESEARCH_CHUNK_BYTES,
  MAX_RESEARCH_EVIDENCE_BYTES,
  MAX_RESEARCH_FRAME_BYTES,
  MAX_RESEARCH_REQUEST_MS,
  MAX_RESEARCH_TOOL_CALLS,
} from './limits.ts'
import { sha256 } from '../db/authority.ts'
import { awaitResearchResult } from './abort.ts'

export interface ResearchToolBroker {
  call: (tool: string, args: unknown, callId: string, signal: AbortSignal) => Promise<unknown>
  close: () => void
}

export type ResearchBrokerFactory = (
  input: ResearchInput,
  signal: AbortSignal,
) => Promise<ResearchToolBroker>

export interface ResearchBrokerDependencies {
  access: ResearchAttemptAccess
  receipts: ResearchReceiptRepository
  readEvidence: EvidenceByteReader
  readInventory: ResearchInventoryRead
  protectedOrigins: readonly string[]
  resolveSource?: SourceResolver
  sourceTransport?: SourceTransport
}

interface CompletedCall {
  fingerprint: string
  result: unknown
}

function validToolArguments(tool: string, args: unknown) {
  try {
    switch (tool) {
      case 'read_evidence':
        validate('ResearchEvidenceRead', args)
        return
      case 'lookup_inventory':
        validate('ResearchInventoryLookup', args)
        return
      case 'fetch_source':
        validate('ResearchSourceFetch', args)
        return
      case 'read_source':
        validate('ResearchReceiptRead', args)
        return
      default:
        refuseResearch('research_tool_refused')
    }
  } catch (error) {
    if (error instanceof ResearchError) {
      throw error
    }
    throw new ResearchError('research_request_invalid', { cause: error })
  }
}

export function researchBroker(dependencies: ResearchBrokerDependencies): ResearchToolBroker {
  const { access, receipts } = dependencies
  const lifetime = new AbortController()
  const completed = new Map<string, CompletedCall>()
  const readEvidence = stagedEvidenceReader(access.manifest, dependencies.readEvidence)
  const readInventory = researchInventoryReader(dependencies.readInventory)
  const fetchSource = sourceFetcher(
    { approvedUrls: access.manifest.source_urls, protectedOrigins: dependencies.protectedOrigins },
    {
      resolve: dependencies.resolveSource,
      transport: dependencies.sourceTransport,
      ensureCurrent: access.ensureCurrent,
    },
  )
  let calls = 0
  let evidenceBytes = 0
  let inFlight = false

  async function readSource(args: ResearchReceiptReadDto, signal: AbortSignal) {
    const retained = await awaitResearchResult(receipts.read(args.receipt_id), signal)
    assertResearchActive(signal)
    if (
      retained.receipt.sha256 !== args.sha256 ||
      sha256(retained.bytes).toString('hex') !== args.sha256 ||
      retained.receipt.byte_size !== String(retained.bytes.length)
    ) {
      refuseResearch('research_receipt_corrupt')
    }
    const result: ResearchSourceChunkDto = {
      receipt: retained.receipt,
      offset: args.offset,
      bytes_base64: researchChunk(retained.bytes, args.offset, args.length).toString('base64'),
    }
    validate('ResearchSourceChunk', result)
    return result
  }

  async function perform(tool: string, args: unknown, requestId: string, signal: AbortSignal) {
    switch (tool) {
      case 'read_evidence': {
        const result = await readEvidence(args as ResearchEvidenceReadDto, signal)
        evidenceBytes += Buffer.from(result.bytes_base64, 'base64').length
        if (evidenceBytes > MAX_RESEARCH_EVIDENCE_BYTES) {
          refuseResearch('research_capacity')
        }
        return result
      }
      case 'lookup_inventory': {
        const request = args as ResearchInventoryLookupDto
        const observation = await readInventory(request, signal)
        await access.ensureCurrent(signal)
        const receipt = await receipts.publish(requestId, request, {
          kind: 'inventory',
          mediaType: 'application/json',
          bytes: Buffer.from(canonical(observation)),
        })
        const result = { receipt, observation }
        validate('ResearchInventoryResult', result)
        return result
      }
      case 'fetch_source': {
        const request = args as ResearchSourceFetchDto
        const source = await fetchSource(request.url, signal)
        await access.ensureCurrent(signal)
        const receipt = await receipts.publish(
          requestId,
          { url: source.url },
          { kind: 'web', mediaType: source.mediaType, sourceUrl: source.url, bytes: source.bytes },
        )
        const result: ResearchSourceChunkDto = {
          receipt,
          offset: '0',
          bytes_base64: source.bytes.subarray(0, MAX_RESEARCH_CHUNK_BYTES).toString('base64'),
        }
        validate('ResearchSourceChunk', result)
        return result
      }
      case 'read_source':
        return readSource(args as ResearchReceiptReadDto, signal)
      default:
        return refuseResearch('research_tool_refused')
    }
  }

  async function call(tool: string, args: unknown, callId: string, cancellation: AbortSignal) {
    const signal = AbortSignal.any([
      lifetime.signal,
      cancellation,
      AbortSignal.timeout(MAX_RESEARCH_REQUEST_MS),
    ])
    assertResearchActive(signal)
    if (!Id.pattern || !new RegExp(Id.pattern).test(callId)) {
      refuseResearch('research_protocol_invalid')
    }
    validToolArguments(tool, args)
    const fingerprint = canonical({ tool, args })
    if (Buffer.byteLength(fingerprint) > MAX_RESEARCH_FRAME_BYTES) {
      refuseResearch('research_capacity')
    }
    const prior = completed.get(callId)
    if (prior) {
      if (prior.fingerprint !== fingerprint) {
        refuseResearch('research_protocol_invalid')
      }
      await access.ensureCurrent(signal)
      return structuredClone(prior.result)
    }
    if (inFlight || calls >= MAX_RESEARCH_TOOL_CALLS) {
      refuseResearch('research_capacity')
    }
    inFlight = true
    calls += 1
    try {
      await access.ensureCurrent(signal)
      const result = await awaitResearchResult(perform(tool, args, callId, signal), signal)
      await access.ensureCurrent(signal)
      assertResearchActive(signal)
      completed.set(callId, { fingerprint, result: structuredClone(result) })
      return result
    } finally {
      inFlight = false
    }
  }

  function close() {
    lifetime.abort()
    completed.clear()
  }

  return Object.freeze({ call, close })
}
