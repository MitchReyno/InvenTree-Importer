import { useId } from 'react'
import styled from 'styled-components'
import type { HeaderWorkDto } from '@invimport/contracts'
import { color, radius, space, typeVar } from '#/theme/generated/tokens'
import { observationFresh, preferredWork, workflowSummary } from '#/header/observations'
import { useCachedBatchReads } from '#/header/useCachedBatchReads'
import {
  batchStepCounts,
  compactJobWord,
  jobGroup,
  otherOpenJobs,
  processingProgress,
  processingSegments,
  segmentSteps,
} from '#/header/workSegments'
import {
  AiMark,
  Spinner,
  media,
  ProgressSegments,
  VisuallyHidden,
  visuallyHidden,
} from '#/components/ui'
import { ActivityPopover } from './ActivityPopover'
import { HeaderDisclosure } from './HeaderDisclosure'

interface Props {
  data?: HeaderWorkDto
  batchId?: string
  unavailable: boolean
  now: number
  /**
   * `phone` reads the step states into the description, since the labels are hidden there;
   * `condensed` is the sticky phone row's copy: the mark and spinner only, with no live region.
   */
  layout?: 'bar' | 'phone' | 'condensed'
  open: boolean
  onOpenChange: (open: boolean) => void
}

/**
 * The masthead's background-work pill: who is working and how far each step is. Inside a batch it
 * leaves out the batch's title and its questions, which the batch header already shows.
 */
export function ActivityIndicator({
  data,
  batchId,
  unavailable,
  now,
  layout = 'bar',
  open,
  onOpenChange,
}: Props) {
  const ids = useId()
  const cached = useCachedBatchReads(batchId)
  const fresh = !unavailable && !!data && observationFresh(data.observed_at, now)
  const preferred = preferredWork(data, batchId)
  const ownBatch = !!batchId && preferred?.batch_id === batchId
  // Outside its batch the pill names the batch it shows, from that batch's cached read.
  const shown = useCachedBatchReads(ownBatch ? undefined : preferred?.batch_id)
  // The open batch's questions and progress, unless the pill names another batch's work.
  const attention = batchId && (!preferred || ownBatch) ? cached.attention : undefined
  // Each retained Processing job is one step, so the pill reads all of the batch's jobs.
  const jobs =
    fresh && data && preferred
      ? data.work.filter((item) => jobGroup(item) === jobGroup(preferred))
      : []
  // Only steps actually running spin; queued and waiting steps do not.
  const running = jobs.some((item) => item.steps.some((step) => step.state === 'running'))
  const idle = fresh && !!data && workflowSummary(data, preferred, false, now) === 'Idle'
  const working = fresh && data && preferred ? agentsWorking(data, preferred.batch_id) : ''
  const headline = working || workflowSummary(data, preferred, unavailable, now)
  let name = shown.title ?? 'Application-wide'
  if (idle) {
    name = 'Nothing running'
  } else if (ownBatch) {
    name = ''
  }
  // Processing work is agent work, so a fresh pill for it leads with the AI mark.
  const agentWork = fresh && preferred?.kind === 'processing'
  const counts = batchStepCounts(data, preferred?.batch_id, attention)
  const segments =
    preferred?.kind === 'processing'
      ? processingSegments(jobs, counts)
      : preferred
        ? segmentSteps(preferred)
        : []
  const progress = fresh && preferred?.kind === 'processing' ? processingProgress(counts) : ''
  const more = fresh && data ? otherOpenJobs(data.work, preferred) : 0
  const compact = !fresh
    ? compactWord(unavailable, !!data)
    : preferred
      ? compactJobWord(preferred)
      : idle
        ? 'Idle'
        : 'Active'
  // A held slot outranks the spinner on the phone pill, which has room for one mark.
  const held = fresh && compact === 'Slot held'
  const showSegments = fresh && !!preferred && layout !== 'condensed'
  const stepWords = segments.map((step) => `${step.label}: ${step.state}`).join(', ')
  const describedBy = [
    `${ids}-headline`,
    name ? `${ids}-name` : '',
    progress ? `${ids}-progress` : '',
    more ? `${ids}-more` : '',
    showSegments && layout === 'phone' ? `${ids}-steps` : '',
  ]
    .filter(Boolean)
    .join(' ')

  return (
    <HeaderDisclosure
      label="Workflow activity"
      title="Workflow details"
      variant="activity"
      active={!idle}
      describedBy={describedBy}
      open={open}
      onOpenChange={onOpenChange}
      trigger={
        <>
          {agentWork && <AiMark size="sm" />}
          {running && (
            <SpinnerSlot data-held={held}>
              <Spinner />
            </SpinnerSlot>
          )}
          <Labels data-compact="visually-hidden">
            {layout === 'condensed' ? (
              <b id={`${ids}-headline`}>{headline}</b>
            ) : (
              <b id={`${ids}-headline`} role="status" aria-live="polite">
                {headline}
              </b>
            )}
            {name && <Name id={`${ids}-name`}>{name}</Name>}
          </Labels>
          {/* At phone width a read that is not current says so first, then the spinner or the
              job's word, beside the step segments. */}
          {(!fresh || !running || held) && <ShortText aria-hidden="true" data-short={compact} />}
          {showSegments && <ProgressSegments steps={segments} />}
          {showSegments && layout === 'phone' && (
            <VisuallyHidden id={`${ids}-steps`}>{stepWords}</VisuallyHidden>
          )}
          {fresh && preferred && (
            <WideOnly>
              {progress && <Current id={`${ids}-progress`}>{progress}</Current>}
              {more > 0 && (
                <More>
                  <span aria-hidden="true">+{more}</span>
                  <VisuallyHidden id={`${ids}-more`}>
                    {more} more {more === 1 ? 'job' : 'jobs'}
                  </VisuallyHidden>
                </More>
              )}
            </WideOnly>
          )}
        </>
      }
    >
      <ActivityPopover
        data={data}
        batchId={batchId}
        batchTitle={cached.title}
        attention={cached.attention}
        unavailable={unavailable}
        fresh={fresh}
      />
    </HeaderDisclosure>
  )
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

/** At phone width the labels hide, so a workflow read that is not current names its state. */
function compactWord(unavailable: boolean, loaded: boolean) {
  if (unavailable) {
    return 'Offline'
  }

  return loaded ? 'Stale' : 'Reading…'
}

const Labels = styled.span`
  display: flex;
  flex-direction: column;
  min-width: 0;
  max-width: 260px;
  line-height: 1.15;
  text-align: left;
  b {
    font-size: ${typeVar.pill.size};
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  ${media.compact} {
    ${visuallyHidden}
  }
`

const Name = styled.span`
  max-width: 160px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: ${typeVar.label.size};
  color: ${color.muted};
`

const Current = styled.span`
  font-size: ${typeVar.label.size};
  color: ${color.muted};
  white-space: nowrap;
`

const More = styled.span`
  padding: 0 ${space[3]};
  border-radius: ${radius.pill};
  background: ${color.accent};
  color: ${color.onAccent};
  font-size: ${typeVar.label.size};
  font-weight: ${typeVar.pill.weight};
`

const ShortText = styled.span`
  display: none;
  max-width: 14ch;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  &::before {
    content: attr(data-short);
  }
  ${media.compact} {
    display: inline;
  }
`

/** At phone width a held slot's word stands in for the spinner; the accent fill still marks running work. */
const SpinnerSlot = styled.span`
  display: contents;
  color: ${color.accent};
  ${media.compact} {
    &[data-held='true'] {
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
