import type { BatchActivityEntryDto, SessionHistoryLinkDto } from '@invimport/contracts'

type Entry = BatchActivityEntryDto['entry']
type LinkKind = SessionHistoryLinkDto['kind']

/** Words, or a link named by its label, in the order they read. */
export type ActivityPart = string | { link: SessionHistoryLinkDto }

/** An activity line: the bold event, then what it concerns as words and links. */
export type ActivityHeadline = {
  lead: string
  parts: ActivityPart[]
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

const ANSWERED = 'You answered: '

/** A lot that no longer leads anywhere, named in plain words rather than another lot's link. */
const NO_LONGER_IN_REVIEW = 'a lot no longer in Review'

/** The entry's first link to that kind of target, a gone one included. */
function linkTo(entry: Entry, kind: LinkKind, gone: string) {
  return entry.links.find(
    (link) => link.kind === kind || (link.kind === 'gone' && link.target === gone),
  )
}

/** " for " and the link, or nothing when the entry has no such link. */
function about(joiner: string, link: SessionHistoryLinkDto | undefined): ActivityPart[] {
  return link ? [` ${joiner} `, { link }] : []
}

function observations(count: number) {
  return `${count} ${count === 1 ? 'observation' : 'observations'}`
}

/** One destination lot: its link while it's in Review, plain words once it isn't. */
function destination(entry: Entry, lotId: string | null): ActivityPart {
  const link = entry.links.find(
    (candidate) => candidate.kind === 'lot' && candidate.lot_id === lotId,
  )
  return link ? { link } : NO_LONGER_IN_REVIEW
}

/** "Packet B", "Packet B and Packet C" or "Packet B, Packet C and Packet D". */
function destinations(entry: Entry, lotIds: readonly (string | null)[]): ActivityPart[] {
  const lots = [...new Set(lotIds)]
  return lots.flatMap((lotId, index): ActivityPart[] => {
    if (index === 0) {
      return [destination(entry, lotId)]
    }
    const separator = index === lots.length - 1 ? ' and ' : ', '
    return [separator, destination(entry, lotId)]
  })
}

/** Where each of these moves went. */
function movedTo(moves: readonly Move[]) {
  return moves.map((move) => move.to_lot_id)
}

/** Every outcome of a regroup, each with all its destinations, most consequential first. */
function regroupHeadline(entry: Entry, details: RegroupDetails, stepLabel: string) {
  if (!details.moves) {
    // Recorded before moves were kept: the lots it named are where observations went.
    return {
      lead: `${stepLabel} regrouped observations`,
      parts: [' into ', ...destinations(entry, details.lot_ids)],
    }
  }

  const of = (outcome: Move['outcome']) => details.moves!.filter((move) => move.outcome === outcome)

  const phrases = [
    { verb: 'moved', moves: of('applied'), joiner: ' to ' },
    { verb: 'suggested moving', moves: of('suggested'), joiner: ' to ' },
    { verb: 'left', moves: of('unchanged'), joiner: ' in place in ' },
  ].filter((phrase) => phrase.moves.length > 0)
  const [first, ...more] = phrases
  if (!first) {
    return { lead: `${stepLabel} regrouped no observations`, parts: [] }
  }
  const parts: ActivityPart[] = [first.joiner, ...destinations(entry, movedTo(first.moves))]
  for (const phrase of more) {
    parts.push(
      `, and ${phrase.verb} ${observations(phrase.moves.length)}${phrase.joiner}`,
      ...destinations(entry, movedTo(phrase.moves)),
    )
  }
  return { lead: `${stepLabel} ${first.verb} ${observations(first.moves.length)}`, parts }
}

function answerHeadline(entry: Entry): ActivityHeadline {
  const values = entry.summary.startsWith(ANSWERED) ? entry.summary.slice(ANSWERED.length) : ''
  const parts: ActivityPart[] = values ? [` ${values}`] : []
  const lot = linkTo(entry, 'lot', 'lot')
  // A whole-batch answer has no lot, so it leads to the question it answered.
  if (!lot) {
    return {
      lead: 'You answered',
      parts: [...parts, ...about('to', linkTo(entry, 'question', 'question'))],
    }
  }
  return { lead: 'You answered', parts: [...parts, ...about('for', lot)] }
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
        parts: about('for', linkTo(entry, 'lot', 'lot')),
      }
    case 'lot': {
      const lot = linkTo(entry, 'lot', 'lot')
      return {
        lead: `${stepLabel} ${details.outcome ? LOT_VERBS[details.outcome] : 'proposed'}`,
        parts: lot ? [' ', { link: lot }] : [],
      }
    }
    case 'regroup':
      return regroupHeadline(entry, details, stepLabel)
    case 'observation': {
      const map = entry.links.find((link) => link.kind === 'map')
      return {
        lead: `${stepLabel} recorded an observation`,
        parts: [
          ...about('in', linkTo(entry, 'capture_evidence', 'evidence')),
          ...(map ? [' · ', { link: map }] : []),
        ],
      }
    }
    case 'question': {
      const question = linkTo(entry, 'question', 'question')
      return { lead: `${stepLabel} asked`, parts: question ? [' ', { link: question }] : [] }
    }
    case 'answer':
      return answerHeadline(entry)
    // The read sends only the actions above; any other entry reads as its own summary.
    case 'status':
    case 'reply':
    case 'photo_view':
    case 'web_read':
    case 'chat':
    case 'instruction':
    case 'evidence':
    case 'revision':
      return { lead: stepLabel, parts: [` ${entry.summary}`] }
  }
}
