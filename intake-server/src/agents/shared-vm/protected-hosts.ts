import { BlockList, isIP } from 'node:net'

/** The guest egress accepts at most this many protected entries per turn. */
export const MAX_PROTECTED_HOSTS = 32

/** The DNS limit for a whole name; the guest egress applies the same one. */
const MAX_DNS_NAME_BYTES = 253

/** Lowercase DNS names with at least two labels, the form the guest egress accepts. */
export const PROTECTED_DNS_NAME =
  /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/

function configurationRequired(): never {
  throw new Error('session_agent_configuration_required')
}

/** True for a DNS name or IP literal in the form the guest egress accepts. */
export function protectedEntry(value: unknown): value is string {
  if (typeof value !== 'string') {
    return false
  }
  const dnsName = value.length <= MAX_DNS_NAME_BYTES && PROTECTED_DNS_NAME.test(value)
  // A zone such as `%eth0` would stop the literal matching the same unscoped address.
  return dnsName || (isIP(value) !== 0 && !value.includes('%'))
}

/** An origin written out in full: scheme, `//` and a non-empty authority. */
const EXPLICIT_ORIGIN = /^https?:\/\/[^/?#\s]/i
/** Characters the URL parser would silently strip or rewrite. */
const REPAIRED_CHARACTERS = /[\\\s\u0000-\u001f\u007f]/

// IANA special-purpose ranges that are not globally reachable; the guest egress uses the same.
const NON_PUBLIC = new BlockList()
for (const [network, prefix] of [
  ['0.0.0.0', 8],
  ['10.0.0.0', 8],
  ['100.64.0.0', 10],
  ['127.0.0.0', 8],
  ['169.254.0.0', 16],
  ['172.16.0.0', 12],
  ['192.0.0.0', 24],
  ['192.0.2.0', 24],
  ['192.88.99.0', 24],
  ['192.168.0.0', 16],
  ['198.18.0.0', 15],
  ['198.51.100.0', 24],
  ['203.0.113.0', 24],
  ['224.0.0.0', 4],
  ['240.0.0.0', 4],
] as const) {
  NON_PUBLIC.addSubnet(network, prefix, 'ipv4')
}
for (const [network, prefix] of [
  ['2001::', 23],
  ['2001:db8::', 32],
  ['2002::', 16],
  ['3fff::', 20],
] as const) {
  NON_PUBLIC.addSubnet(network, prefix, 'ipv6')
}
const GLOBAL_UNICAST_V6 = new BlockList()
GLOBAL_UNICAST_V6.addSubnet('2000::', 3, 'ipv6')

/** The IPv4 address an IPv4-mapped IPv6 literal such as `::ffff:101:101` stands for. */
function mappedIpv4(address: string): string | undefined {
  const match = /^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/.exec(address)
  if (!match) {
    return undefined
  }
  const high = Number.parseInt(match[1], 16)
  const low = Number.parseInt(match[2], 16)
  return [high >> 8, high & 255, low >> 8, low & 255].join('.')
}

/** True for an IP literal the egress refuses anyway, so it needn't be protected. */
function nonPublicLiteral(host: string): boolean {
  const ipv4 = isIP(host) === 4 ? host : mappedIpv4(host)
  if (ipv4 !== undefined) {
    return NON_PUBLIC.check(ipv4, 'ipv4')
  }
  if (isIP(host) === 6) {
    return !GLOBAL_UNICAST_V6.check(host, 'ipv6') || NON_PUBLIC.check(host, 'ipv6')
  }
  return false
}

/** The host of one configured origin in standard form, or undefined for bare `localhost`. */
function originHost(origin: string): string | undefined {
  // The URL parser would repair forms such as `https:host`; a configured origin must not need it.
  if (!EXPLICIT_ORIGIN.test(origin) || REPAIRED_CHARACTERS.test(origin)) {
    return configurationRequired()
  }
  let url: URL
  try {
    url = new URL(origin)
  } catch {
    return configurationRequired()
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    return configurationRequired()
  }
  // An origin is scheme, host and port only: no credentials, path, query or fragment. The raw
  // check also catches an empty `?` or `#`, which URL drops.
  const originOnly =
    url.username === '' &&
    url.password === '' &&
    url.pathname === '/' &&
    !/[@?#]/.test(origin) &&
    !/^https?:\/\/[^/]+\/./i.test(origin)
  if (!originOnly) {
    return configurationRequired()
  }
  // WHATWG hosts are already lowercase with international names in punycode.
  const bracketless = url.hostname.replace(/^\[(.*)\]$/, '$1')
  const host = bracketless.endsWith('.') ? bracketless.slice(0, -1) : bracketless
  // Bare `localhost` and non-public literals are refused by the egress whatever the policy, so
  // they needn't use the protected-host budget. Dotted `.localhost` names are kept, so the guest
  // can classify what they resolve to.
  if (host === 'localhost' || nonPublicLiteral(host)) {
    return undefined
  }
  if (!protectedEntry(host)) {
    return configurationRequired()
  }
  return host
}

/**
 * The hosts the guest egress must refuse, from comma-separated origins the deployment serves
 * or reads. An origin that can't be represented is refused rather than dropped, because
 * dropping it would leave that host reachable.
 */
export function protectedHosts(origins: string): string[] {
  const entries = origins.split(',').map((entry) => entry.trim())
  if (entries.some((entry) => entry === '')) {
    return configurationRequired()
  }
  const hosts = new Set<string>()
  for (const entry of entries) {
    const host = originHost(entry)
    if (host !== undefined) {
      hosts.add(host)
    }
  }
  if (hosts.size > MAX_PROTECTED_HOSTS) {
    return configurationRequired()
  }
  return [...hosts].sort()
}

/** Protected hosts for the worker's VM bridge; only the tool-worker profile needs them. */
export function bridgeProtectedHosts(env: NodeJS.ProcessEnv, profileId: string): string[] {
  if (profileId !== 'shared-vm-agent/3') {
    return []
  }
  const origins = env.INTAKE_AGENT_PROTECTED_ORIGINS
  if (origins === undefined) {
    return configurationRequired()
  }
  return protectedHosts(origins)
}
