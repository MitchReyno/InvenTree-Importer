import { useId, useState } from 'react'
import type { HeaderWorkDto } from '@invimport/contracts'
import styled from 'styled-components'
import { color, radius, space, typeVar } from '../../theme/generated/tokens'
import { media } from '../ui/media'
import { VisuallyHidden, visuallyHidden } from '../ui/VisuallyHidden'
import { Button } from '../ui/Button'
import { Spinner } from '../ui/Loading'
import { Pill } from '../ui/Pill'
import { ProgressSegments } from '../ui/ProgressSegments'
import type { HeaderClient } from '../../header/types'
import { useHeaderObservations } from '../../header/useHeaderObservations'
import { useCachedBatchReads } from '../../header/useCachedBatchReads'
import { segmentSteps, stepTone } from '../../header/workSegments'
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
  const cached = useCachedBatchReads(batchId)
  const ownBatch = !!batchId && preferred?.batch_id === batchId
  const working =
    workFresh && workData && preferred ? agentsWorking(workData, preferred.batch_id) : ''
  const headline = working || workText
  const scopeName = ownBatch ? (cached.title ?? 'Current batch') : 'Application-wide'
  const questions = ownBatch ? (cached.attention?.processing.questions ?? 0) : 0
  const ids = useId()
  const describedBy = [`${ids}-headline`, `${ids}-scope`, questions ? `${ids}-questions` : '']
    .filter(Boolean)
    .join(' ')
  const inventreeLink = navigation ? (
    <Button
      as="a"
      variant="ghost"
      size="sm"
      aria-label="Open InvenTree"
      href={navigation}
      target="_blank"
      rel="noopener noreferrer"
    >
      Open InvenTree ↗
    </Button>
  ) : (
    <UnavailableLink>Open InvenTree unavailable</UnavailableLink>
  )
  return (
    <StatusRow aria-label="Application status">
      <HeaderDisclosure
        label="Workflow activity"
        title="Workflow details"
        active={workActive}
        describedBy={describedBy}
        trigger={
          <TriggerContent>
            {workActive && (
              <SpinnerSlot data-questions={questions > 0}>
                <Spinner />
              </SpinnerSlot>
            )}
            <ActivityLabels data-compact="visually-hidden">
              <span id={`${ids}-headline`} role="status" aria-live="polite">
                {headline}
              </span>
              <Scope id={`${ids}-scope`}>{scopeName}</Scope>
            </ActivityLabels>
            {!(workFresh && preferred) && <ShortText aria-hidden="true" data-short={workShort} />}
            {workFresh && preferred && (
              <WideOnly>
                <ProgressSegments
                  steps={segmentSteps(preferred, ownBatch ? cached.attention : undefined)}
                />
              </WideOnly>
            )}
            {questions > 0 && (
              <QuestionPill>
                <Pill tone="warn">
                  <span aria-hidden="true">{questions}</span>
                  <VisuallyHidden id={`${ids}-questions`}>
                    {questions} {questions === 1 ? 'question needs' : 'questions need'} you
                  </VisuallyHidden>
                </Pill>
              </QuestionPill>
            )}
          </TriggerContent>
        }
        open={open === 'workflow'}
        onOpenChange={(value) => setOpen(value ? 'workflow' : null)}
      >
        <WorkflowDetails
          data={workData}
          batchId={batchId}
          attention={cached.attention}
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
        <PhoneTarget>{inventreeLink}</PhoneTarget>
      </HeaderDisclosure>
      <BarTarget>{inventreeLink}</BarTarget>
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

/** Sessions holding a running slot; one waiting for an answer holds none. */
function agentsWorking(data: HeaderWorkDto, batch: string) {
  const count = data.active_sessions.filter(
    (session) => session.batch_id === batch && session.occupies_lane,
  ).length
  if (!count) {
    return ''
  }

  const more = data.sessions_truncated ? '+' : ''
  return `${count}${more} ${count === 1 && !more ? 'agent' : 'agents'} working`
}

// The masthead's end group lays these out in one row with its menu.
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
    font-size: ${typeVar.pill.size};
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
  font-size: ${typeVar.label.size};
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
  border-radius: ${radius.round};
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

/** A count beside the segments, tighter than a status pill so it fits the phone touch target. */
const QuestionPill = styled.span`
  display: contents;
  & > span {
    gap: ${space[1]};
    padding: 0 ${space[3]} 0 ${space[2]};
  }
`

/** At phone width the question count stands in for the spinner; the accent fill still marks running work. */
const SpinnerSlot = styled.span`
  display: contents;
  ${media.compact} {
    &[data-questions='true'] {
      display: none;
    }
  }
`

/** The phone bar has room for one mark only; the panel lists the steps. */
const WideOnly = styled.span`
  display: contents;
  ${media.compact} {
    display: none;
  }
`

const UnavailableLink = styled.span`
  font-size: ${typeVar.small.size};
  color: ${color.muted};
`

/** At phone width the bar has no room for Open InvenTree, so it moves into the connection panel. */
const BarTarget = styled.span`
  display: contents;
  ${media.compact} {
    display: none;
  }
`

const PhoneTarget = styled.div`
  display: none;
  margin-top: ${space[5]};
  ${media.compact} {
    display: block;
  }
`
