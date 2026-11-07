import { useState } from 'react'
import styled, { css } from 'styled-components'
import { color, radius, space } from '../../theme/generated/tokens'
import { media } from '../ui/media'
import { Spinner } from '../ui/Loading'
import type { HeaderClient } from '../../header/types'
import { useHeaderObservations } from '../../header/useHeaderObservations'
import {
  observationFresh,
  preferredWork,
  safeTargetNavigation,
  targetStatus,
  workflowSummary,
} from '../../header/observations'
import { useUpdateHealth } from '../operations/LiveUpdates'
import { HeaderDisclosure } from './HeaderDisclosure'
import { ConnectionDetails } from './ConnectionDetails'
import { WorkflowDetails } from './WorkflowDetails'

interface Props {
  client: HeaderClient
  batchId?: string
  bootstrapUnavailable?: boolean
}

export function HeaderStatus({ client, batchId, bootstrapUnavailable = false }: Props) {
  const { now, connection, work } = useHeaderObservations(client, batchId)
  const health = useUpdateHealth()
  const [open, setOpen] = useState<'connection' | 'workflow' | null>(null)
  const connectionUnavailable =
    bootstrapUnavailable || connection.isError || connection.fetchStatus === 'paused'
  const workUnavailable = bootstrapUnavailable || work.isError || work.fetchStatus === 'paused'
  const connectionData = connection.isFetchedAfterMount ? connection.data : undefined
  const workData = work.isFetchedAfterMount ? work.data : undefined
  const target = connectionData?.target
  const connectionStatus = targetStatus(target, connectionUnavailable, now)
  const preferred = preferredWork(workData, batchId)
  const workText = workflowSummary(workData, preferred, workUnavailable, now)
  const navigation = safeTargetNavigation(target?.navigation_url)
  const workFresh = !workUnavailable && !!workData && observationFresh(workData.observed_at, now)
  const workShort = compactWorkWord({
    unavailable: workUnavailable,
    loaded: !!workData,
    fresh: workFresh,
    hasWork: !!preferred,
  })
  const workActive =
    workFresh && !!preferred && preferred.steps.some((step) => stepTone(step.state) === 'running')
  return (
    <StatusRow aria-label="Application status">
      <HeaderDisclosure
        label="Workflow activity"
        title="Workflow details"
        active={workActive}
        trigger={
          <TriggerContent>
            {workActive && <Spinner />}
            <ActivityLabels data-compact="visually-hidden">
              <span role="status" aria-live="polite">
                {workText}
              </span>
              <Scope>
                {batchId && preferred?.batch_id === batchId ? 'Current batch' : 'Application-wide'}
              </Scope>
            </ActivityLabels>
            {!(workFresh && preferred) && <ShortText aria-hidden="true" data-short={workShort} />}
            {workFresh && preferred && (
              <Segments role="list" aria-label="Known retained steps">
                {preferred.steps.map((step, index) => {
                  const name = 'stage' in step ? step.stage : step.name

                  return (
                    <Segment
                      role="listitem"
                      aria-label={`${name}: ${step.state}`}
                      key={index}
                      title={`${name}: ${step.state}`}
                      data-tone={stepTone(step.state)}
                    />
                  )
                })}
              </Segments>
            )}
          </TriggerContent>
        }
        open={open === 'workflow'}
        onOpenChange={(value) => setOpen(value ? 'workflow' : null)}
      >
        <WorkflowDetails
          data={workData}
          batchId={batchId}
          unavailable={workUnavailable}
          fresh={workFresh}
        />
      </HeaderDisclosure>
      <HeaderDisclosure
        label="Connection status"
        title="Connection details"
        trigger={
          <TriggerContent>
            <Dot data-tone={connectionStatus.tone} />
            <ConnectionText
              role="status"
              aria-live="polite"
              data-compact="visually-hidden"
              title={connectionStatus.summary}
            >
              {connectionStatus.summary}
            </ConnectionText>
            <ShortText aria-hidden="true" data-short={connectionStatus.short} />
          </TriggerContent>
        }
        open={open === 'connection'}
        onOpenChange={(value) => setOpen(value ? 'connection' : null)}
      >
        <ConnectionDetails
          target={target}
          apiUnavailable={connectionUnavailable}
          apiChecked={connection.isFetchedAfterMount ? connection.dataUpdatedAt : 0}
          now={now}
          health={health}
        />
      </HeaderDisclosure>
      {navigation ? (
        <TargetLink
          aria-label="Open InvenTree"
          href={navigation}
          target="_blank"
          rel="noopener noreferrer"
        >
          Open InvenTree ↗
        </TargetLink>
      ) : (
        <UnavailableLink>Open InvenTree unavailable</UnavailableLink>
      )}
    </StatusRow>
  )
}

type WorkView = { unavailable: boolean; loaded: boolean; fresh: boolean; hasWork: boolean }

/** At phone width the activity labels hide; without segments to show, this word stands in. */
function compactWorkWord({ unavailable, loaded, fresh, hasWork }: WorkView) {
  if (unavailable) {
    return 'Offline'
  }
  if (!loaded) {
    return 'Reading…'
  }
  if (!fresh) {
    return 'Stale'
  }

  return hasWork ? 'Active' : 'Idle'
}

type StepTone = 'done' | 'running' | 'failed' | 'other'

const STEP_TONE: Record<string, StepTone> = {
  ready: 'done',
  confirmed: 'done',
  finished: 'done',
  queued: 'running',
  running: 'running',
  waiting_for_user: 'running',
  waiting_for_login: 'running',
  waiting_for_capacity: 'running',
  failed: 'failed',
  interrupted: 'failed',
  cancelled: 'failed',
}

function stepTone(state: string): StepTone {
  return STEP_TONE[state] ?? 'other'
}

const visuallyHidden = css`
  position: absolute;
  width: 1px;
  height: 1px;
  margin: -1px;
  overflow: hidden;
  clip: rect(0 0 0 0);
  white-space: nowrap;
`

// The masthead's end group lays these out with its menu, so they wrap as one set.
const StatusRow = styled.div`
  display: contents;
`

const TriggerContent = styled.span`
  display: flex;
  align-items: center;
  gap: ${space[3]};
  min-width: 0;
  text-align: left;
  color: ${color.accent};
`

const ActivityLabels = styled.span`
  display: flex;
  flex-direction: column;
  min-width: 0;
  max-width: 260px;
  line-height: 1.15;
  color: ${color.fg};
  & > span:first-child {
    font-size: 12px;
    font-weight: 700;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  ${media.compact} {
    ${visuallyHidden}
  }
`

const Scope = styled.small`
  max-width: 160px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 11px;
  color: ${color.muted};
`

const dotTone = {
  ok: color.ok,
  info: color.info,
  warn: color.warn,
  bad: color.bad,
  muted: color.muted,
}

const Dot = styled.span<{ 'data-tone': keyof typeof dotTone }>`
  flex: none;
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: ${(props) => dotTone[props['data-tone']]};
`

const ConnectionText = styled.span`
  min-width: 0;
  max-width: 28ch;
  overflow: hidden;
  text-overflow: ellipsis;
  color: ${color.fg};
  white-space: nowrap;
  ${media.compact} {
    ${visuallyHidden}
  }
`

const ShortText = styled.span`
  display: none;
  max-width: 14ch;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: ${color.fg};
  &::before {
    content: attr(data-short);
  }
  ${media.compact} {
    display: inline;
  }
`

const segmentTone = {
  done: color.ok,
  running: color.accent,
  failed: color.bad,
  other: color.lineStrong,
}

const Segments = styled.span`
  display: flex;
  flex: none;
  gap: 2px;
`

const Segment = styled.span<{ 'data-tone': StepTone }>`
  display: block;
  width: 14px;
  height: 6px;
  border-radius: 2px;
  background: ${(props) => segmentTone[props['data-tone']]};
`

const TargetLink = styled.a`
  display: inline-flex;
  align-items: center;
  min-height: 32px;
  padding: ${space[2]} 9px;
  border: 1px solid transparent;
  border-radius: ${radius.btn};
  color: ${color.fg};
  font-size: 12.5px;
  font-weight: 500;
  text-decoration: none;
  &:hover {
    background: ${color.surface2};
  }
  ${media.compact} {
    min-height: 44px;
  }
`

const UnavailableLink = styled.span`
  font-size: 12.5px;
  color: ${color.muted};
`
