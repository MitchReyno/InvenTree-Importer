import type { BatchActivityEntryDto, SessionHistoryLinkDto } from '@invimport/contracts'

type Entry = BatchActivityEntryDto['entry']
type LinkKind = SessionHistoryLinkDto['kind']

/** An activity line: the bold event, any words after it, and the subject it links to. */
export type ActivityHeadline = {
  lead: string
  rest?: string
  joiner?: string
  link?: SessionHistoryLinkDto
}

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
      return {
        lead: `${stepLabel} regrouped observations`,
        joiner: 'in',
        link: linkTo(entry, 'lot', 'lot'),
      }
    case 'observation':
      return {
        lead: `${stepLabel} recorded an observation`,
        joiner: 'in',
        link: linkTo(entry, 'capture_evidence', 'evidence'),
      }
    case 'question':
      return { lead: `${stepLabel} asked`, link: linkTo(entry, 'question', 'question') }
    case 'answer':
      return {
        lead: 'You answered',
        rest: entry.summary.startsWith(ANSWERED) ? entry.summary.slice(ANSWERED.length) : undefined,
        joiner: 'for',
        link: linkTo(entry, 'lot', 'lot'),
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
