import styled from 'styled-components'
import { webPageUrlAccepted, type SessionHistoryLinkDto } from '@invimport/contracts'
import { Link } from '#/components/ui'
import { batchHref, sessionPageHref, type ProcessingStep } from '#/navigation/batch-route'
import { color, space, typeVar } from '#/theme/generated/tokens'

/** Where a history list sits: its batch, the session's job and the step that shows it. */
export type HistoryContext = {
  batchId: string
  jobId: string
  step: ProcessingStep
  /** Shows and focuses another loaded entry, such as the proposal citing a web read. */
  showEntry?: (entryId: string) => void
}

/** A link's text and address in this app, or plain text where it no longer leads anywhere. */
function linkTarget(link: SessionHistoryLinkDto, context: HistoryContext) {
  const { batchId } = context
  switch (link.kind) {
    case 'lot':
      return {
        text: `Open ${link.label} in Review`,
        href: batchHref(batchId, { tab: 'review', view: 'lots', lotId: link.lot_id }),
      }
    case 'map':
      return { text: 'Show on the map', href: batchHref(batchId, { tab: 'review', view: 'map' }) }
    case 'capture_evidence':
      return {
        text: `Open ${link.label} in Capture`,
        href: batchHref(batchId, { tab: 'capture', photoId: link.evidence_id }),
      }
    case 'record':
      return {
        text: `Open ${link.label} in Records`,
        href: batchHref(batchId, {
          tab: 'review',
          view: 'records',
          recordType: 'part',
          recordId: link.part_subject_id,
        }),
      }
    case 'note':
      return { text: `Open the note: ${link.label}`, href: noteHref(link, batchId) }
    case 'question':
      return {
        text: `Question: ${link.label}`,
        href: batchHref(batchId, {
          tab: 'processing',
          step: context.step,
          questionId: link.question_id,
        }),
      }
    case 'failure':
      return {
        text: 'Failure details',
        href: sessionPageHref(batchId, context.step, context.jobId),
      }
    case 'external_url':
      return { text: link.label, href: link.url }
    case 'gone':
      return { text: link.label }
  }
}

/** A capture note opens its lot in Review, an evidence note its photo in Capture. */
function noteHref(link: Extract<SessionHistoryLinkDto, { kind: 'note' }>, batchId: string) {
  if (link.evidence_id) {
    return batchHref(batchId, { tab: 'capture', photoId: link.evidence_id })
  }
  if (link.subject_id) {
    return batchHref(batchId, { tab: 'review', view: 'lots', lotId: link.subject_id })
  }
  return batchHref(batchId, { tab: 'capture' })
}

/** One typed link: a web page opens in a new tab marked agent-reported; a gone one is text. */
export function HistoryLink({
  link,
  context,
}: {
  link: SessionHistoryLinkDto
  context: HistoryContext
}) {
  const target = linkTarget(link, context)
  if (target.href === undefined) {
    return <Gone>{target.text}</Gone>
  }
  if (link.kind === 'external_url') {
    if (!webPageUrlAccepted(link.url)) {
      return <span>{target.text}</span>
    }
    return (
      <Link href={target.href} target="_blank" rel="noopener noreferrer">
        {target.text} ↗ <Reported>agent-reported</Reported>
      </Link>
    )
  }
  return <Link href={target.href}>{target.text}</Link>
}

/** An entry's links in one row; the same target is linked once. */
export function HistoryLinks({
  links,
  context,
}: {
  links: readonly SessionHistoryLinkDto[]
  context: HistoryContext
}) {
  const unique = new Map(links.map((link) => [JSON.stringify(link), link]))
  if (unique.size === 0) {
    return null
  }
  return (
    <Row>
      {[...unique].map(([key, link]) => (
        <HistoryLink key={key} link={link} context={context} />
      ))}
    </Row>
  )
}

const Row = styled.div`
  display: flex;
  flex-wrap: wrap;
  gap: ${space[2]} ${space[5]};
  font-size: ${typeVar.small.size};
`

const Gone = styled.span`
  color: ${color.muted};
`

const Reported = styled.span`
  color: ${color.warn};
`
