import type {
  ClaudeProviderStatusDto,
  CodexProviderStatusDto,
  ProviderStatusUnknownReason,
} from '@invimport/contracts'
import type { PillTone } from '#/components/ui'

/** One provider's answer from the read-only status, or what a confirmed sign-in change showed. */
export type ProviderState = ClaudeProviderStatusDto['state'] | CodexProviderStatusDto['state']

/** What a provider card's pill says: only what the agent VM can report. */
export type ProviderPill = { word: string; tone: PillTone; glyph: string }

const CHECKING: ProviderPill = { word: 'Checking…', tone: 'outline', glyph: '⟳' }

const STATE_PILL: Record<Exclude<ProviderState, 'unknown'>, ProviderPill> = {
  saved: { word: 'Token saved', tone: 'ok', glyph: '✓' },
  not_saved: { word: 'No token', tone: 'outline', glyph: '–' },
  signed_in: { word: 'Signed in', tone: 'ok', glyph: '✓' },
  signing_in: { word: 'Signing in', tone: 'acc', glyph: '⟳' },
  signed_out: { word: 'Not signed in', tone: 'outline', glyph: '–' },
}

/** A Codex check the card waited for didn't finish before it stopped waiting. */
export const TIMED_OUT: ProviderPill = { word: 'Status timed out', tone: 'warn', glyph: '!' }

/** Each reason the status couldn't be read; none of them means signed out. */
const UNKNOWN_WORD: Record<Exclude<ProviderStatusUnknownReason, 'checking'>, string> = {
  vm_unreachable: 'Can’t reach the agent VM',
  guest_outdated: 'Agent VM needs an update',
  busy: 'Agent VM busy',
  timeout: TIMED_OUT.word,
  service_unavailable: 'Sign-in service not running',
  worker_unavailable: 'Session worker not answering',
  not_configured: 'No agent VM in this profile',
}

/** The status route itself failed, so nothing is known about either provider. */
export const READ_FAILED: ProviderPill = { word: 'Status unavailable', tone: 'warn', glyph: '!' }

/** The pill for "Checking…": a read under way, or one the VM hasn't finished yet. */
export function checkingPill() {
  return CHECKING
}

/** The pill for one provider's answer. A reason not known to this build reads as unavailable. */
export function providerPill(
  status: ClaudeProviderStatusDto | CodexProviderStatusDto,
): ProviderPill {
  if (status.state !== 'unknown') {
    return STATE_PILL[status.state]
  }
  // A VM still working on its first answer is checking, not failing.
  if (status.reason === 'checking') {
    return CHECKING
  }
  const word = UNKNOWN_WORD[status.reason] ?? READ_FAILED.word
  return { word, tone: 'warn', glyph: '!' }
}

/** A confirmed state the card shows until the VM's own status catches up. */
export function confirmedPill(state: Exclude<ProviderState, 'unknown'>) {
  return STATE_PILL[state]
}
