import type { BatchActivityEntryDto, SessionHistoryLinkDto } from '@invimport/contracts'

type Entry = BatchActivityEntryDto['entry']
type LinkKind = SessionHistoryLinkDto['kind']

/** An activity line: the bold event, any words after it, and the subject it links to. */
export type ActivityHeadline = {
  lead: string
  rest?: string
  joiner?: string
  link?: SessionHistoryLinkDto
  /** Words after the link, such as "and 2 other lots". */
  after?: string
  /** A second place to see it, such as an observation's spot on the map. */
  also?: SessionHistoryLinkDto
}

type RegroupDetails = Extract<Entry['details'], { kind: 'regroup' }>
type Move = NonNullable<RegroupDetails['moves']>[number]

const LOT_VERBS = {
  formed: 'formed',
  extended: 'extended',
  suggested: 'suggested changes to',
  unchanged: 'proposed no change to',
}

/** What each step's proposals are about. */
const PROPOSED: Record<BatchActivityEntryDto['stage'], string> = {
  examine: 'a proposal',
  reading: 'a reading',
  identifying: 'an identity',
  research: 'an identity',
  images: 'images',
  inventory: 'a stock match',
}

/** The entry's first link to that kind of target, a gone one included. */
function linkTo(entry: Entry, kind: LinkKind, gone: string) {
  return entry.links.find(
    (link) => link.kind === kind || (link.kind === 'gone' && link.target === gone),
  )
}

const ANSWERED = 'You answered: '

function observations(count: number) {
  return `${count} ${count === 1 ? 'observation' : 'observations'}`
}

/** A destination lot's link, or plain words when that lot no longer leads anywhere. */
function destinationLink(entry: Entry, lotId: string | null): SessionHistoryLinkDto {
  const link = entry.links.find(
    (candidate) => candidate.kind === 'lot' && candidate.lot_id === lotId,
  )
  return link ?? { kind: 'gone', target: 'lot', label: 'a lot no longer in Review' }
}

/** "to Packet B", or "to Packet B and 2 other lots", for moves of one outcome. */
function destinations(entry: Entry, moves: readonly Move[]) {
  const lots = [...new Set(moves.map((move) => move.to_lot_id))]
  const others = lots.length - 1
  return {
    joiner: 'to',
    link: destinationLink(entry, lots[0] ?? null),
    after: others > 0 ? `and ${others} other ${others === 1 ? 'lot' : 'lots'}` : undefined,
  }
}

/** Says whether the regroup moved, only suggested or left its observations, by its outcomes. */
function regroupHeadline(entry: Entry, details: RegroupDetails, stepLabel: string) {
  if (!details.moves) {
    // Recorded before moves were kept: the lots it named are where observations went.
    return {
      lead: `${stepLabel} regrouped observations`,
      joiner: 'into',
      link: destinationLink(entry, details.lot_ids[0] ?? null),
    }
  }

  const of = (outcome: Move['outcome']) => details.moves!.filter((move) => move.outcome === outcome)

  const applied = of('applied')
  const suggested = of('suggested')
  const unchanged = of('unchanged')
  if (applied.length) {
    const moved = destinations(entry, applied)
    const alsoSuggested = suggested.length
      ? `and suggested moving ${observations(suggested.length)}`
      : undefined
    const after = [moved.after, alsoSuggested].filter(Boolean).join(', ')
    return {
      lead: `${stepLabel} moved ${observations(applied.length)}`,
      ...moved,
      after: after || undefined,
    }
  }
  if (suggested.length) {
    return {
      lead: `${stepLabel} suggested moving ${observations(suggested.length)}`,
      ...destinations(entry, suggested),
    }
  }
  return {
    lead: `${stepLabel} left ${observations(unchanged.length)} in place`,
    joiner: 'in',
    link: destinationLink(entry, unchanged[0]?.to_lot_id ?? null),
  }
}

/**
 * The app's words for one recorded action, such as "Research proposed an identity for" a lot,
 * built from what it recorded rather than the agent's status line.
 */
export function activityHeadline(item: BatchActivityEntryDto, stepLabel: string): ActivityHeadline {
  const { entry } = item
  const details = entry.details
  switch (details.kind) {
    case 'proposal':
      return {
        lead: `${stepLabel} proposed ${PROPOSED[item.stage]}`,
        joiner: 'for',
        link: linkTo(entry, 'lot', 'lot'),
      }
    case 'lot':
      return {
        lead: `${stepLabel} ${details.outcome ? LOT_VERBS[details.outcome] : 'proposed'}`,
        link: linkTo(entry, 'lot', 'lot'),
      }
    case 'regroup':
      return regroupHeadline(entry, details, stepLabel)
    case 'observation':
      return {
        lead: `${stepLabel} recorded an observation`,
        joiner: 'in',
        link: linkTo(entry, 'capture_evidence', 'evidence'),
        also: entry.links.find((link) => link.kind === 'map'),
      }
    case 'question':
      return { lead: `${stepLabel} asked`, link: linkTo(entry, 'question', 'question') }
    case 'answer': {
      const rest = entry.summary.startsWith(ANSWERED)
        ? entry.summary.slice(ANSWERED.length)
        : undefined
      const lot = linkTo(entry, 'lot', 'lot')
      // A whole-batch answer has no lot, so it leads to the question it answered.
      if (!lot) {
        return {
          lead: 'You answered',
          rest,
          joiner: 'to',
          link: linkTo(entry, 'question', 'question'),
        }
      }
      return { lead: 'You answered', rest, joiner: 'for', link: lot }
    }
    // The read sends only the actions above; any other entry reads as its own summary.
    case 'status':
    case 'reply':
    case 'photo_view':
    case 'web_read':
    case 'chat':
    case 'instruction':
    case 'evidence':
    case 'revision':
      return { lead: stepLabel, rest: entry.summary }
  }
}
