import styled from 'styled-components'
import type { BatchActivityEntryDto } from '@invimport/contracts'
import { EventTime, Small } from '#/components/ui'
import { processingStepFor } from '#/navigation/batch-route'
import { color, radius, space, typeVar } from '#/theme/generated/tokens'
import { ActivitySubject } from './ActivitySubject'
import { Muted, STEP_LABEL } from './ProcessingParts'
import { activityHeadline } from '#/processing/activity-words'

type Props = {
  batchId: string
  /** Newest first; absent while the first read loads or after it failed. */
  entries?: readonly BatchActivityEntryDto[]
  /** The latest read failed or is paused, so any entries shown are the last copy. */
  failed?: boolean
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
  // A failed or paused refresh keeps the last copy on screen, and says so.
  const stale = failed && (
    <Small role="status">Recent activity couldn’t be refreshed; showing the last copy.</Small>
  )
  if (entries.length === 0) {
    return (
      <>
        {stale}
        <Muted>No agent activity yet.</Muted>
      </>
    )
  }
  return (
    <>
      {stale}
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
                      <ActivitySubject link={headline.link} item={item} batchId={batchId} />
                    </>
                  )}
                  {headline.also && (
                    <>
                      {' · '}
                      <ActivitySubject link={headline.also} item={item} batchId={batchId} />
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
    </>
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
