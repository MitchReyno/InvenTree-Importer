import { useId } from 'react'
import styled from 'styled-components'
import type { HeaderWorkDto } from '@invimport/contracts'
import { color, radius, space, typeVar } from '#/theme/generated/tokens'
import { observationFresh, preferredWork } from '#/header/observations'
import { useCachedBatchReads } from '#/header/useCachedBatchReads'
import {
  batchStepCounts,
  jobGroup,
  otherOpenJobs,
  processingProgress,
  processingSegments,
  segmentSteps,
  slotHeld,
} from '#/header/workSegments'
import { workSummary, type WorkSummary } from '#/header/workSummary'
import {
  AiMark,
  Spinner,
  media,
  ProgressSegments,
  VisuallyHidden,
  visuallyHidden,
  WORK_STATE,
  type WorkState,
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
  const summary = workSummary({ data, batchId, batchTitle: cached.title, unavailable, fresh })
  const preferred = shownWork(data, batchId, summary)
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
  const idle = summary.idle
  const headline = summary.headline
  const name = summaryName(summary, batchId, preferred && !ownBatch ? shown.title : undefined)
  // Processing work is agent work, so a fresh desktop pill for it leads with the AI mark. The phone
  // button is the agents status button, so it always carries it.
  const showMark = layout !== 'bar' || (fresh && preferred?.kind === 'processing')
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
    : compactSummaryWord(summary, !!preferred && slotHeld(preferred))
  // A held slot outranks the spinner on the phone pill, where its word stands in for the labels.
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
          {showMark && <AiMark size="sm" />}
          {fresh && summary.state && summary.state !== 'working' && (
            <Glyph aria-hidden="true" $state={summary.state}>
              {WORK_STATE[summary.state].glyph}
            </Glyph>
          )}
          {running && (
            // At phone width a held slot's or an urgent headline's word takes the spinner's place.
            <SpinnerSlot data-held={held || (fresh && urgent(summary))}>
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
          {(!fresh || !running || held || urgent(summary)) && (
            <ShortText aria-hidden="true" data-short={compact} />
          )}
          {showSegments && (
            <Segments data-named={fresh && urgent(summary)}>
              <ProgressSegments steps={segments} />
            </Segments>
          )}
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

/**
 * The work the pill's segments show. Outside a batch it is only the headline's batch's work, so a
 * name, spinner and segments never come from another batch; a batch with only sessions shows none.
 */
function shownWork(
  data: HeaderWorkDto | undefined,
  batchId: string | undefined,
  summary: WorkSummary,
) {
  if (batchId || !data) {
    return preferredWork(data, batchId)
  }
  if (!summary.batchId) {
    return undefined
  }
  const own = data.work.filter((item) => item.batch_id === summary.batchId)

  return own.length ? preferredWork({ ...data, work: own }, summary.batchId) : undefined
}

/**
 * The line under the headline: inside a batch, what else needs attention, or the batch whose work
 * the segments show when it is not the open one; outside one, the batch the pill names.
 */
function summaryName(summary: WorkSummary, batchId: string | undefined, shownTitle?: string) {
  if (batchId) {
    return summary.detail ?? shownTitle ?? ''
  }

  return summary.state ? (shownTitle ?? 'Application-wide') : ''
}

/** A failure, a wait or an incomplete read keeps its word on the phone pill beside a spinner. */
function urgent(summary: WorkSummary) {
  return (
    summary.state === 'failed' ||
    summary.state === 'waiting_for_you' ||
    summary.headline === 'Status incomplete'
  )
}

/** One short word for the phone pill: the summary's state, or a held slot's. */
function compactSummaryWord(summary: WorkSummary, held: boolean) {
  if (summary.idle) {
    return 'Idle'
  }
  if (held && !urgent(summary)) {
    return 'Slot held'
  }
  // A failure or a wait names its step and count beside its glyph, as the full headline does.
  if (summary.short) {
    return summary.short
  }
  if (summary.state) {
    return WORK_STATE[summary.state].word
  }

  return summary.headline === 'Status incomplete' ? 'Incomplete' : 'Active'
}

/** At phone width the labels hide, so a workflow read that is not current names its state. */
function compactWord(unavailable: boolean, loaded: boolean) {
  if (unavailable) {
    return 'Unavailable'
  }

  return loaded ? 'Stale' : 'Reading…'
}

const GLYPH_COLOR: Partial<Record<WorkState, string>> = {
  failed: color.bad,
  waiting_for_you: color.warn,
}

/** The headline state's glyph, so a failure or a wait reads without its colour. */
const Glyph = styled.span<{ $state: WorkState }>`
  font-weight: ${typeVar.pill.weight};
  color: ${(props) => GLYPH_COLOR[props.$state] ?? color.muted};
`

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

/** The phone pill keeps only its marks and segments; the panel gives the progress and other jobs. */
const WideOnly = styled.span`
  display: contents;
  ${media.compact} {
    display: none;
  }
`

/** Narrower segments at phone width, so the button fits beside the brand and menu at 360px. */
const Segments = styled.span`
  display: contents;
  ${media.compact} {
    /* A named failure or wait says which step itself, so the segments give way to the brand. */
    &[data-named='true'] {
      display: none;
    }
    [data-state] {
      /* literal-allowed: a phone segment's width, as ProgressSegments' own 14px; no token has this role */
      width: 8px;
    }
  }
`
