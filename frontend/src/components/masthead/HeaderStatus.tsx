import { useState } from 'react'
import styled from 'styled-components'
import type { HeaderClient } from '../../header/types'
import { useHeaderObservations } from '../../header/useHeaderObservations'
import {
  observationFresh,
  preferredWork,
  safeTargetNavigation,
  targetSummary,
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
  const targetText = targetSummary(target, connectionUnavailable, now)
  const preferred = preferredWork(workData, batchId)
  const workText = workflowSummary(workData, preferred, workUnavailable, now)
  const navigation = safeTargetNavigation(target?.navigation_url)
  const workFresh = !workUnavailable && !!workData && observationFresh(workData.observed_at, now)
  const targetGood =
    !connectionUnavailable &&
    target?.state === 'reachable' &&
    target.freshness === 'fresh' &&
    observationFresh(target.observed_at, now)
  return (
    <StatusRow aria-label="Application status">
      <HeaderDisclosure
        label="Workflow activity"
        title="Workflow details"
        trigger={
          <TriggerContent>
            <span role="status" aria-live="polite">
              {workText}
            </span>
            <Scope>
              {batchId && preferred?.batch_id === batchId ? 'Current batch' : 'Application-wide'}
            </Scope>
            {workFresh && preferred && (
              <Segments role="list" aria-label="Known retained steps">
                {preferred.steps.map((step, index) => (
                  <Segment
                    role="listitem"
                    aria-label={`${'stage' in step ? step.stage : step.name}: ${step.state}`}
                    key={index}
                    title={`${'stage' in step ? step.stage : step.name}: ${step.state}`}
                  />
                ))}
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
      <ConnectionRow>
        <HeaderDisclosure
          label="Connection status"
          title="Connection details"
          trigger={
            <TriggerContent>
              <Dot $good={targetGood} />
              <span role="status" aria-live="polite">
                {targetText}
              </span>
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
      </ConnectionRow>
    </StatusRow>
  )
}

const StatusRow = styled.div`
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: flex-end;
  gap: 8px;
  min-width: 0;
  max-width: 100%;
`
const ConnectionRow = styled.div`
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  align-items: center;
  min-width: 0;
`
const TriggerContent = styled.span`
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 6px;
  min-width: 0;
  font-size: 12px;
  text-align: left;
`
const Scope = styled.small`
  color: #526179;
`
const Dot = styled.span<{ $good: boolean }>`
  display: inline-block;
  width: 7px;
  height: 7px;
  border-radius: 50%;
  flex: none;
  background: ${(p) => (p.$good ? '#4eaa3d' : '#9a6b18')};
`
const Segments = styled.span`
  display: flex;
  gap: 3px;
  width: 100%;
`
const Segment = styled.span`
  height: 4px;
  min-width: 16px;
  flex: 1;
  background: #3577cb;
  border-radius: 2px;
`
const TargetLink = styled.a`
  min-height: 2rem;
  display: inline-flex;
  align-items: center;
  color: #233349;
  font-size: 12px;
  font-weight: 500;
  text-decoration: none;
  border-radius: 0.5rem;
  border: 1px solid transparent;
  padding: 0.25rem 0.5rem;
  &:hover {
    border-color: #266ac5;
    background: #edf4ff;
  }
`
const UnavailableLink = styled.span`
  font-size: 12px;
  color: #526179;
`
