import { request as httpRequest, type RequestOptions } from 'node:http'
import { request as httpsRequest } from 'node:https'
import type { IncomingMessage } from 'node:http'
import type { SourceResolver, SourcePolicy, PinnedSource } from './source-policy.ts'
import { pinSourceDestination } from './source-policy.ts'
import { assertResearchActive, ResearchError, refuseResearch } from './errors.ts'
import { MAX_RESEARCH_REQUEST_MS, MAX_RESEARCH_SOURCE_BYTES } from './limits.ts'
import { awaitResearchResult } from './abort.ts'

export interface FetchedSource {
  url: string
  mediaType: 'text/html' | 'text/plain' | 'application/pdf'
  bytes: Buffer
}

export interface SourceResponse {
  status: number
  mediaType: string
  bytes: Buffer
}

export type SourceTransport = (
  destination: PinnedSource,
  signal: AbortSignal,
) => Promise<SourceResponse>

async function readSourceBody(response: IncomingMessage): Promise<Buffer> {
  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of response) {
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
    size += bytes.length
    if (size > MAX_RESEARCH_SOURCE_BYTES) {
      response.destroy()
      refuseResearch('research_capacity')
    }
    chunks.push(bytes)
  }
  if (size === 0) {
    refuseResearch('research_source_invalid')
  }
  return Buffer.concat(chunks)
}

/** Connect to the validated address directly; Host and TLS SNI retain the approved hostname. */
export const requestPinnedSource: SourceTransport = async (destination, signal) => {
  assertResearchActive(signal)
  const { url, address } = destination
  const request = url.protocol === 'https:' ? httpsRequest : httpRequest
  const options: RequestOptions & { servername: string } = {
    protocol: url.protocol,
    hostname: address.address,
    family: address.family,
    port: url.port ? Number(url.port) : url.protocol === 'https:' ? 443 : 80,
    method: 'GET',
    path: `${url.pathname}${url.search}`,
    servername: url.hostname.replace(/^\[|\]$/g, ''),
    agent: false,
    maxHeaderSize: 16 * 1024,
    signal,
    headers: {
      host: url.host,
      accept: 'text/html, text/plain, application/pdf',
      'user-agent': 'BenchIntake-SourceBroker/1',
    },
  }
  return new Promise<SourceResponse>((resolve, reject) => {
    const outgoing = request(options, (response) => {
      const status = response.statusCode ?? 0
      const mediaType =
        response.headers['content-type']?.split(';', 1)[0].trim().toLowerCase() ?? ''
      const encoding = response.headers['content-encoding']
      if (status !== 200 || (encoding && encoding !== 'identity')) {
        response.destroy()
        reject(new ResearchError('research_source_unavailable'))
        return
      }
      readSourceBody(response).then((bytes) => resolve({ status, mediaType, bytes }), reject)
    })
    outgoing.once('error', reject)
    outgoing.end()
  })
}

export function sourceFetcher(
  policy: SourcePolicy,
  dependencies: {
    resolve?: SourceResolver
    transport?: SourceTransport
    ensureCurrent?: (signal: AbortSignal) => Promise<void>
  } = {},
) {
  const retainedPolicy = structuredClone(policy)
  return async function fetchSource(
    value: string,
    cancellation: AbortSignal,
  ): Promise<FetchedSource> {
    assertResearchActive(cancellation)
    const deadline = AbortSignal.timeout(MAX_RESEARCH_REQUEST_MS)
    const signal = AbortSignal.any([cancellation, deadline])
    try {
      await dependencies.ensureCurrent?.(signal)
      const destination = await pinSourceDestination(
        value,
        retainedPolicy,
        signal,
        dependencies.resolve,
      )
      await dependencies.ensureCurrent?.(signal)
      const response = await awaitResearchResult(
        (dependencies.transport ?? requestPinnedSource)(destination, signal),
        signal,
      )
      assertResearchActive(signal)
      await dependencies.ensureCurrent?.(signal)
      if (response.status !== 200) {
        refuseResearch('research_source_unavailable')
      }
      if (!['text/html', 'text/plain', 'application/pdf'].includes(response.mediaType)) {
        refuseResearch('research_source_invalid')
      }
      if (!response.bytes.length || response.bytes.length > MAX_RESEARCH_SOURCE_BYTES) {
        refuseResearch('research_capacity')
      }
      return {
        url: destination.url.href,
        mediaType: response.mediaType as FetchedSource['mediaType'],
        bytes: response.bytes,
      }
    } catch (error) {
      if (cancellation.aborted) {
        throw new ResearchError('research_cancelled')
      }
      if (deadline.aborted) {
        throw new ResearchError('research_source_unavailable')
      }
      if (error instanceof ResearchError) {
        throw error
      }
      throw new ResearchError('research_source_unavailable', { cause: error })
    }
  }
}
