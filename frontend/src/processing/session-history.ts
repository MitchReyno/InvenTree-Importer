import type {
  SessionHistoryAttemptDto,
  SessionHistoryDto,
  SessionHistoryEntryDto,
  SessionHistoryLinkDto,
} from '@invimport/contracts'

type Entry = SessionHistoryEntryDto

/** The entries a session page holds, newest first, and the cursor for the next older page. */
export type HeldHistory = {
  session: SessionHistoryDto['session']
  entries: Entry[]
  before?: string
}

/** One row of a history list: an entry, a run grouped into one, or the drawer's folded line. */
export type HistoryItem =
  | { kind: 'entry'; id: string; summary: string; entry: Entry }
  | { kind: 'group'; id: string; summary: string; entries: Entry[] }
  | { kind: 'elided'; id: string; summary: string }

/** An entry or a group: every row except the drawer's folded line. */
type EntryRow = Exclude<HistoryItem, { kind: 'elided' }>

/** A row of the session page's conversation: the history's rows plus a divider per attempt. */
export type ConversationItem =
  HistoryItem | { kind: 'attempt'; id: string; attempt: SessionHistoryAttemptDto }

export type ConversationFilter = 'all' | 'messages' | 'inputs' | 'photos' | 'web'

/** Web reads are derived from their proposal and aren't rows of the page the cursor counts. */
function isStoredRow(entry: Entry) {
  return entry.details.kind !== 'web_read'
}

/**
 * Replaces the held newest page with a fresh read of it. Held entries older than the new page
 * stay, so one new entry never pushes another out of view; when the new page shares no stored
 * row with the held entries, they are dropped so no gap is left, and Load older continues from it.
 */
export function mergeNewestPage(
  held: HeldHistory | undefined,
  page: SessionHistoryDto,
): HeldHistory {
  const fresh: HeldHistory = {
    session: page.session,
    entries: page.entries,
    ...(page.before ? { before: page.before } : {}),
  }
  if (!held || !page.before) {
    return fresh
  }
  // The deepest held row the new page also holds: held rows below it are older than the page,
  // since the page holds every row from its own oldest up, a late commit included.
  const storedOnPage = new Set(page.entries.filter(isStoredRow).map((entry) => entry.id))
  const overlapAt = held.entries.findLastIndex((entry) => storedOnPage.has(entry.id))
  if (overlapAt === -1) {
    return fresh
  }
  const onPage = new Set(page.entries.map((entry) => entry.id))
  const olderHeld = held.entries.slice(overlapAt + 1).filter((entry) => !onPage.has(entry.id))

  return {
    session: page.session,
    entries: [...page.entries, ...olderHeld],
    ...(held.before ? { before: held.before } : {}),
  }
}

/**
 * Adds the page read from `cursor` below the held entries. A page read from a cursor the held
 * entries no longer end at, because a refresh replaced them meanwhile, is dropped.
 */
export function appendOlderPage(
  held: HeldHistory,
  page: SessionHistoryDto,
  cursor: string,
): HeldHistory {
  if (held.before !== cursor) {
    return held
  }
  const known = new Set(held.entries.map((entry) => entry.id))
  const older = page.entries.filter((entry) => !known.has(entry.id))

  return {
    session: held.session,
    entries: [...held.entries, ...older],
    ...(page.before ? { before: page.before } : {}),
  }
}

function evidenceLink(entry: Entry) {
  return entry.links.find(
    (link): link is Extract<SessionHistoryLinkDto, { kind: 'capture_evidence' }> =>
      link.kind === 'capture_evidence',
  )
}

/** What makes consecutive agent entries one group: the same kind about the same subject or photo. */
function groupKey(entry: Entry): string | null {
  if (entry.who !== 'agent') {
    return null
  }
  const { details } = entry
  if (details.kind === 'observation') {
    return details.current ? `observation:${details.current.evidence_version_id}` : null
  }
  if (details.kind === 'photo_view') {
    return `photo_view:${details.view.version_id}`
  }
  if (details.kind === 'web_read') {
    return `web_read:${details.proposal_entry_id}`
  }
  if (details.kind === 'lot') {
    return details.lot ? `lot:${details.lot.id}` : null
  }
  // Other kinds stay one entry each; questions keep their own cards.
  return null
}

function plural(count: number, one: string, many = `${one}s`) {
  return `${count} ${count === 1 ? one : many}`
}

function groupSummary(entries: Entry[]) {
  const first = entries[0]
  const photo = evidenceLink(first)?.label ?? 'one photo'
  const kind = first.details.kind
  if (kind === 'observation') {
    return `Recorded ${entries.length} observations in ${photo}`
  }
  if (kind === 'photo_view') {
    return `Prepared ${plural(entries.length, 'view')} of ${photo} for the agent`
  }
  if (kind === 'web_read') {
    return `Read ${entries.length} web pages`
  }
  return `${first.summary} · ${plural(entries.length - 1, 'later change')}`
}

function entryItem(entry: Entry): EntryRow {
  return { kind: 'entry', id: entry.id, summary: entry.summary, entry }
}

/** Groups consecutive agent entries of one kind about one subject or photo, in the order given. */
export function groupEntries(entries: readonly Entry[]): EntryRow[] {
  const items: EntryRow[] = []
  let run: Entry[] = []

  const flush = () => {
    if (run.length > 1) {
      items.push({ kind: 'group', id: run[0].id, summary: groupSummary(run), entries: run })
    } else if (run.length === 1) {
      items.push(entryItem(run[0]))
    }
    run = []
  }

  for (const entry of entries) {
    const key = groupKey(entry)
    if (key === null) {
      flush()
      items.push(entryItem(entry))
      continue
    }
    if (run.length > 0 && groupKey(run[0]) !== key) {
      flush()
    }
    run.push(entry)
  }
  flush()
  return items
}

const isFolded = (entry: Entry) =>
  entry.details.kind === 'photo_view' || entry.details.kind === 'web_read'

const isChat = (entry: Entry) => entry.details.kind === 'chat' || entry.details.kind === 'reply'

function foldedSummary(run: Entry[]) {
  const photos = run.filter((entry) => entry.details.kind === 'photo_view').length
  const pages = run.length - photos
  const parts = [
    { count: pages, text: `read ${plural(pages, 'web page')}` },
    { count: photos, text: `viewed ${plural(photos, 'photo')}` },
  ]
  const text = parts
    .filter((part) => part.count > 0)
    .map((part) => part.text)
    .join(' · ')
  return text.charAt(0).toUpperCase() + text.slice(1)
}

/**
 * The drawer's history, oldest first, messages, replies and answers in their place, with each run
 * of photo views and web reads, mixed or not, folded into one line the session page spells out.
 */
export function drawerItems(entries: readonly Entry[]): HistoryItem[] {
  const oldestFirst = [...entries].reverse()
  const items: HistoryItem[] = []
  let run: Entry[] = []

  const flushRun = () => {
    if (run.length > 0) {
      items.push({ kind: 'elided', id: `elided:${run[0].id}`, summary: foldedSummary(run) })
    }
    run = []
  }

  let pending: Entry[] = []

  const flushPending = () => {
    items.push(...groupEntries(pending))
    pending = []
  }

  for (const entry of oldestFirst) {
    if (isFolded(entry)) {
      flushPending()
      run.push(entry)
      continue
    }
    flushRun()
    pending.push(entry)
  }
  flushRun()
  flushPending()
  return items
}

const FILTERS: Record<Exclude<ConversationFilter, 'all'>, (entry: Entry) => boolean> = {
  messages: isChat,
  // The operator's answers, instructions and chat, and the app's notices of their corrections.
  inputs: (entry) => entry.who !== 'agent',
  photos: (entry) => entry.details.kind === 'photo_view',
  web: (entry) => entry.details.kind === 'web_read',
}

/** How many loaded entries a filter shows. */
export function filterCount(entries: readonly Entry[], filter: ConversationFilter) {
  return filter === 'all' ? entries.length : entries.filter(FILTERS[filter]).length
}

/** Whether a conversation row shows under a filter; attempt dividers always show. */
export function shownUnder(item: ConversationItem, filter: ConversationFilter) {
  if (filter === 'all' || item.kind === 'attempt' || item.kind === 'elided') {
    return true
  }
  const entries = item.kind === 'group' ? item.entries : [item.entry]
  return entries.some(FILTERS[filter])
}

/**
 * The session page's conversation, oldest first: grouped actions, chat, questions and inputs,
 * with a divider where each attempt was queued. Entries are grouped only between dividers, so an
 * attempt's actions never sit above its own divider. While older entries remain to load, an
 * attempt gets its divider only when it was queued within the loaded entries or owns one of them.
 */
export function conversation(held: HeldHistory): ConversationItem[] {
  const oldestFirst = [...held.entries].reverse()
  const oldestLoaded = oldestFirst[0]?.at
  const owning = new Set(
    held.entries.flatMap((entry) => (entry.who === 'agent' ? [entry.attempt] : [])),
  )
  const dividers = attemptsOldestFirst(held.session.attempts).filter((attempt) => {
    const queuedWithin = oldestLoaded !== undefined && attempt.queued_at >= oldestLoaded
    return held.before === undefined || queuedWithin || owning.has(attempt.number)
  })
  const items: ConversationItem[] = []
  let segment: Entry[] = []
  let next = 0
  for (const entry of oldestFirst) {
    if (next < dividers.length && dividers[next].queued_at <= entry.at) {
      items.push(...groupEntries(segment))
      segment = []
    }
    while (next < dividers.length && dividers[next].queued_at <= entry.at) {
      items.push(dividerItem(dividers[next]))
      next += 1
    }
    segment.push(entry)
  }
  items.push(...groupEntries(segment))
  for (; next < dividers.length; next += 1) {
    items.push(dividerItem(dividers[next]))
  }
  return items
}

/** The read lists attempts newest first; the conversation needs them by queue time. */
export function attemptsOldestFirst(attempts: readonly SessionHistoryAttemptDto[]) {
  return [...attempts].sort((a, b) => a.queued_at.localeCompare(b.queued_at) || a.number - b.number)
}

function dividerItem(attempt: SessionHistoryAttemptDto): ConversationItem {
  return { kind: 'attempt', id: `attempt:${attempt.id}`, attempt }
}

/** Each photo the loaded entries show the agent was sent, with how many views it had. */
export function viewedPhotos(entries: readonly Entry[]) {
  const photos = new Map<string, { link: SessionHistoryLinkDto; label: string; views: number }>()
  for (const entry of entries) {
    if (entry.details.kind !== 'photo_view') {
      continue
    }
    const link: SessionHistoryLinkDto = evidenceLink(entry) ??
      entry.links[0] ?? { kind: 'gone', target: 'evidence', label: 'Photo removed' }
    const key = entry.details.view.version_id
    const known = photos.get(key)
    if (known) {
      known.views += 1
    } else {
      photos.set(key, { link, label: 'label' in link ? link.label : 'Photo', views: 1 })
    }
  }
  return [...photos.values()]
}

/** The photos, notes and web pages the loaded proposals cite, once each. */
export function citedSources(entries: readonly Entry[]) {
  const sources = new Map<string, { link: SessionHistoryLinkDto; label: string }>()
  for (const entry of entries) {
    if (entry.details.kind !== 'proposal') {
      continue
    }
    for (const link of entry.links) {
      const key = sourceKey(link)
      if (key && !sources.has(key)) {
        sources.set(key, { link, label: 'label' in link ? link.label : key })
      }
    }
  }
  return [...sources.values()]
}

function sourceKey(link: SessionHistoryLinkDto) {
  if (link.kind === 'capture_evidence') {
    return `evidence:${link.version_id}`
  }
  if (link.kind === 'note') {
    return `note:${link.note_id}`
  }
  if (link.kind === 'external_url') {
    return `url:${link.url}`
  }
  // Lots, questions and the rest aren't sources.
  return null
}

/** How a row sits on the action rail: a dot for an agent's action, none for anything else. */
export type RailMark = {
  action: boolean
  /** The line below this row: solid to an adjacent action, dashed across rows between. */
  line: 'solid' | 'dashed' | null
  /** The latest action of a working session. */
  now: boolean
}

function isAction(item: ConversationItem) {
  if (item.kind === 'elided' || item.kind === 'group') {
    return item.kind === 'elided' || item.entries[0].who === 'agent'
  }
  if (item.kind === 'attempt') {
    return false
  }
  return item.entry.who === 'agent' && !isChat(item.entry)
}

/** Each row's place on the rail, given whether the session is working now. */
export function railMarks(items: readonly ConversationItem[], working: boolean): RailMark[] {
  const actions = items.flatMap((item, index) => (isAction(item) ? [index] : []))
  const first = actions[0] ?? -1
  const last = actions.at(-1) ?? -1

  return items.map((_item, index) => {
    const action = actions.includes(index)
    let line: RailMark['line'] = null
    if (index >= first && index < last) {
      line = action && actions.includes(index + 1) ? 'solid' : 'dashed'
    }
    return { action, line, now: working && index === last }
  })
}
