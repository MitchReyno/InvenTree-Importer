import styled from 'styled-components'
import type { BatchActivityEntryDto, SessionHistoryLinkDto } from '@invimport/contracts'
import { EventTime, Link, Small } from '#/components/ui'
import { processingStepFor } from '#/navigation/batch-route'
import { color, radius, space, typeVar } from '#/theme/generated/tokens'
import { linkTarget } from './HistoryLink'
import { Muted, STEP_LABEL } from './ProcessingParts'
import { activityHeadline } from '#/processing/activity-words'

type Props = {
  batchId: string
  /** Newest first; absent while the read loads or after it failed. */
  entries?: readonly BatchActivityEntryDto[]
  failed?: boolean
}

/** The headline's subject, named by its label and linked where it still leads somewhere. */
function Subject({
  link,
  item,
  batchId,
}: {
  link: SessionHistoryLinkDto
  item: BatchActivityEntryDto
  batchId: string
}) {
  const context = { batchId, jobId: item.job_id, step: processingStepFor(item.stage) }
  const target = linkTarget(link, context)
  const label = 'label' in link ? link.label : target.text
  if (target.href === undefined || link.kind === 'external_url') {
    return <span>{label}</span>
  }
  return <Link href={target.href}>{label}</Link>
}

/**
 * Processing's recent activity: each entry leads with the app's recorded event in plain words,
 * linked to what it concerns, with the job's latest status line as a muted note in the agent's own
 * words. Newest first.
 */
export function RecentActivity({ batchId, entries, failed = false }: Props) {
  if (!entries) {
    return failed ? (
      <Muted>Recent activity couldn’t be loaded.</Muted>
    ) : (
      <Small role="status">Loading recent activity…</Small>
    )
  }
  if (entries.length === 0) {
    return <Muted>No agent activity yet.</Muted>
  }
  return (
    <List aria-label="Recent activity">
      {entries.map((item) => {
        const headline = activityHeadline(
          item,
          STEP_LABEL[processingStepFor(item.stage)] ?? 'Processing',
        )
        return (
          <li key={`${item.job_id}:${item.entry.id}`}>
            <Marker aria-hidden="true" />
            <Body>
              <span>
                <strong>{headline.lead}</strong>
                {headline.rest && ` ${headline.rest}`}
                {headline.link && (
                  <>
                    {' '}
                    {headline.joiner && `${headline.joiner} `}
                    <Subject link={headline.link} item={item} batchId={batchId} />
                  </>
                )}
              </span>
              {item.agent_note && <Note>Agent: {item.agent_note.text}</Note>}
            </Body>
            <EventTime at={item.entry.at} />
          </li>
        )
      })}
    </List>
  )
}

const List = styled.ol`
  display: flex;
  flex-direction: column;
  gap: ${space[4]};
  margin: 0;
  padding: 0;
  list-style: none;
  li {
    display: grid;
    grid-template-columns: auto minmax(0, 1fr) auto;
    gap: ${space[3]};
    align-items: baseline;
    font-size: ${typeVar.small.size};
  }
  time {
    color: ${color.muted};
    white-space: nowrap;
  }
`

const Marker = styled.span`
  width: 8px;
  height: 8px;
  border-radius: ${radius.round};
  border: 2px solid ${color.muted};
  box-sizing: border-box;
`

const Body = styled.span`
  display: grid;
  gap: ${space[1]};
  min-width: 0;
  overflow-wrap: anywhere;
`

const Note = styled.span`
  color: ${color.muted};
`
