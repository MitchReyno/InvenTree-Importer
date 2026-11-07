import { useId } from 'react'
import styled from 'styled-components'
import type { HeaderWorkDto } from '@invimport/contracts'
import { color, radius, space, typeVar } from '../../theme/generated/tokens'
import { observationFresh, preferredWork, workflowSummary } from '../../header/observations'
import { useCachedBatchReads } from '../../header/useCachedBatchReads'
import {
  compactJobWord,
  jobGroup,
  otherOpenJobs,
  processingProgress,
  processingSegments,
  segmentSteps,
} from '../../header/workSegments'
import { Spinner } from '../ui/Loading'
import { media } from '../ui/media'
import { Pill } from '../ui/Pill'
import { ProgressSegments } from '../ui/ProgressSegments'
import { VisuallyHidden, visuallyHidden } from '../ui/VisuallyHidden'
import { ActivityPopover } from './ActivityPopover'
import { HeaderDisclosure } from './HeaderDisclosure'

interface Props {
  data?: HeaderWorkDto
  batchId?: string
  unavailable: boolean
  now: number
  open: boolean
  onOpenChange: (open: boolean) => void
}

/** The masthead's background-work pill: who is working, on what, and how far each step is. */
export function ActivityIndicator({ data, batchId, unavailable, now, open, onOpenChange }: Props) {
  const ids = useId()
  const cached = useCachedBatchReads(batchId)
  const fresh = !unavailable && !!data && observationFresh(data.observed_at, now)
  const preferred = preferredWork(data, batchId)
  const ownBatch = !!batchId && preferred?.batch_id === batchId
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
  const name = idle
    ? 'Nothing running'
    : ownBatch
      ? (cached.title ?? 'Current batch')
      : 'Application-wide'
  const questions = attention?.processing.questions ?? 0
  const segments =
    preferred?.kind === 'processing'
      ? processingSegments(jobs, attention)
      : preferred
        ? segmentSteps(preferred)
        : []
  const progress = fresh && preferred?.kind === 'processing' ? processingProgress(attention) : ''
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
  const describedBy = [
    `${ids}-headline`,
    `${ids}-name`,
    progress ? `${ids}-progress` : '',
    more ? `${ids}-more` : '',
    questions ? `${ids}-questions` : '',
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
          {running && (
            <SpinnerSlot data-questions={questions > 0 || held}>
              <Spinner />
            </SpinnerSlot>
          )}
          <Labels data-compact="visually-hidden">
            <b id={`${ids}-headline`} role="status" aria-live="polite">
              {headline}
            </b>
            <Name id={`${ids}-name`}>{name}</Name>
          </Labels>
          {/* At phone width one mark shows: a read that is not current says so first, then the
              question count, the spinner or the job's word. */}
          {(!fresh || (questions === 0 && (!running || held))) && (
            <ShortText aria-hidden="true" data-short={compact} />
          )}
          {fresh && preferred && (
            <WideOnly>
              <ProgressSegments steps={segments} />
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
          {questions > 0 && (
            <QuestionPill data-current={fresh}>
              <Pill tone="warn">
                <span aria-hidden="true">{questions}</span>
                <VisuallyHidden id={`${ids}-questions`}>
                  {questions} {questions === 1 ? 'question needs' : 'questions need'} you
                </VisuallyHidden>
              </Pill>
            </QuestionPill>
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

/** A count beside the segments, tighter than a status pill so it fits the phone touch target. */
const QuestionPill = styled.span`
  display: contents;
  & > span {
    gap: ${space[1]};
    padding: 0 ${space[3]} 0 ${space[2]};
  }
  ${media.compact} {
    &[data-current='false'] > span {
      display: none;
    }
  }
`

/** At phone width the question count stands in for the spinner; the accent fill still marks running work. */
const SpinnerSlot = styled.span`
  display: contents;
  color: ${color.accent};
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
