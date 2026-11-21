import ipaddr from 'ipaddr.js'
import { isIP } from 'node:net'
import { lookup } from 'node:dns/promises'
import {
  MAX_RESEARCH_DNS_ANSWERS,
  MAX_RESEARCH_PROTECTED_ORIGINS,
  MAX_RESEARCH_SOURCE_URLS,
  MAX_RESEARCH_URL_BYTES,
} from './limits.ts'
import { assertResearchActive, refuseResearch } from './errors.ts'
import { awaitResearchResult } from './abort.ts'

export interface SourceAddress {
  address: string
  family: 4 | 6
}

export type SourceResolver = (hostname: string) => Promise<readonly SourceAddress[]>

export interface SourcePolicy {
  approvedUrls: readonly string[]
  protectedOrigins: readonly string[]
}

export interface PinnedSource {
  url: URL
  address: SourceAddress
}

export function canonicalSourceUrl(value: string): URL {
  if (Buffer.byteLength(value) > MAX_RESEARCH_URL_BYTES || /[\u0000-\u0020\u007f]/.test(value)) {
    refuseResearch('research_source_refused')
  }
  let url: URL
  try {
    url = new URL(value)
  } catch {
    return refuseResearch('research_source_refused')
  }
  const allowedProtocol = url.protocol === 'https:' || url.protocol === 'http:'
  if (!allowedProtocol || url.username || url.password || url.hash || url.port) {
    refuseResearch('research_source_refused')
  }
  return url
}

function sourceHostname(url: URL): string {
  return url.hostname
    .replace(/^\[|\]$/g, '')
    .replace(/\.$/, '')
    .toLowerCase()
}

export function publicSourceAddress(value: string): SourceAddress {
  const family = isIP(value)
  if (!family || value.includes('%')) {
    return refuseResearch('research_source_refused')
  }
  const address = ipaddr.process(value)
  if (address.range() !== 'unicast') {
    refuseResearch('research_source_refused')
  }
  return { address: address.toString(), family: address.kind() === 'ipv4' ? 4 : 6 }
}

const resolveSource: SourceResolver = async (hostname) => {
  const addresses = await lookup(hostname, { all: true, verbatim: true })
  return addresses.map((address) => ({
    address: address.address,
    family: address.family === 4 ? 4 : 6,
  }))
}

async function resolvedAddresses(hostname: string, signal: AbortSignal, resolve: SourceResolver) {
  const literalFamily = isIP(hostname)
  const addresses = literalFamily
    ? [{ address: hostname, family: literalFamily as 4 | 6 }]
    : await awaitResearchResult(resolve(hostname), signal)
  if (addresses.length === 0 || addresses.length > MAX_RESEARCH_DNS_ANSWERS) {
    refuseResearch('research_source_refused')
  }
  return addresses
}

function protectedHostnames(policy: SourcePolicy): Set<string> {
  if (
    policy.protectedOrigins.length === 0 ||
    policy.protectedOrigins.length > MAX_RESEARCH_PROTECTED_ORIGINS
  ) {
    refuseResearch('research_source_refused')
  }
  return new Set(
    policy.protectedOrigins.map((origin) => {
      let url: URL
      try {
        url = new URL(origin)
      } catch {
        return refuseResearch('research_source_refused')
      }
      if (
        !['http:', 'https:'].includes(url.protocol) ||
        url.username ||
        url.password ||
        url.search ||
        url.hash ||
        url.pathname !== '/'
      ) {
        refuseResearch('research_source_refused')
      }
      return sourceHostname(url)
    }),
  )
}

/** Exact URL admission prevents tool arguments from encoding private evidence into arbitrary URLs. */
export async function pinSourceDestination(
  value: string,
  policy: SourcePolicy,
  signal: AbortSignal,
  resolve: SourceResolver = resolveSource,
): Promise<PinnedSource> {
  assertResearchActive(signal)
  if (policy.approvedUrls.length > MAX_RESEARCH_SOURCE_URLS) {
    refuseResearch('research_source_refused')
  }
  const url = canonicalSourceUrl(value)
  const admitted = policy.approvedUrls.some(
    (approved) => canonicalSourceUrl(approved).href === url.href,
  )
  if (!admitted) {
    refuseResearch('research_source_refused')
  }
  const hostname = sourceHostname(url)
  const protectedHosts = protectedHostnames(policy)
  if (protectedHosts.has(hostname)) {
    refuseResearch('research_source_refused')
  }
  const resolved = await resolvedAddresses(hostname, signal, resolve)
  assertResearchActive(signal)
  const addresses = resolved.map((address) => {
    if (isIP(address.address) !== address.family) {
      refuseResearch('research_source_refused')
    }
    return publicSourceAddress(address.address)
  })
  const protectedAddresses = new Set<string>()
  for (const protectedHost of protectedHosts) {
    const protectedResolved = await resolvedAddresses(protectedHost, signal, resolve)
    assertResearchActive(signal)
    for (const address of protectedResolved) {
      if (!isIP(address.address)) {
        refuseResearch('research_source_refused')
      }
      protectedAddresses.add(ipaddr.process(address.address).toString())
    }
  }
  if (addresses.some((address) => protectedAddresses.has(address.address))) {
    refuseResearch('research_source_refused')
  }
  return { url, address: addresses[0] }
}
