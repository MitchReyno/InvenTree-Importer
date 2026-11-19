import { isIP } from 'node:net'

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
  return dnsName || isIP(value) !== 0
}

/** An origin written out in full: scheme, `//` and a non-empty authority. */
const EXPLICIT_ORIGIN = /^https?:\/\/[^/?#\s]/i

/** The host of one configured origin in standard form, or undefined for bare `localhost`. */
function originHost(origin: string): string | undefined {
  // The URL parser would repair forms such as `https:host`; a configured origin must not need it.
  if (!EXPLICIT_ORIGIN.test(origin)) {
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
  // WHATWG hosts are already lowercase with international names in punycode.
  const bracketless = url.hostname.replace(/^\[(.*)\]$/, '$1')
  const host = bracketless.endsWith('.') ? bracketless.slice(0, -1) : bracketless
  // A single-label name the egress never accepts as a target; it resolves to loopback.
  // Dotted `.localhost` names are kept, so the guest can classify what they resolve to.
  if (host === 'localhost') {
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
 * dropping it would leave that host reachable. Loopback and private literals are kept; the
 * egress skips non-public addresses itself.
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
  if (profileId !== 'shared-vm-agent/2') {
    return []
  }
  const origins = env.INTAKE_AGENT_PROTECTED_ORIGINS
  if (origins === undefined) {
    return configurationRequired()
  }
  return protectedHosts(origins)
}
