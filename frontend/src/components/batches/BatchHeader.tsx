import type { BatchAttentionDto, CaptureSnapshotDto } from '@invimport/contracts'
import styled from 'styled-components'
import {
  batchHref,
  type BatchRoute,
  type BatchTab,
  type ProcessingStep,
} from '../../navigation/batch-route'
import { color, pageWidth, space, type, typeVar } from '../../theme/generated/tokens'
import { Button } from '../ui/Button'
import { media } from '../ui/media'
import { SubTabs, Tabs, type TabItem } from '../ui/Tabs'
import { Pill } from '../ui/Pill'
import { NeedsYouPanel } from './NeedsYouPanel'

type BatchHeaderProps = {
  batch: CaptureSnapshotDto
  route: BatchRoute
  attention: BatchAttentionDto | undefined
  /** The attention read failed, so the header cannot say what needs the operator. */
  attentionUnavailable?: boolean
  /** Lots retired by a split or merge stay in the snapshot; counts show active lots. */
  activeLotCount: number
  retiredLotCount: number
  busy: boolean
  onArchive: () => void
}

const STEPS: { id: ProcessingStep; label: string }[] = [
  { id: 'overview', label: 'Overview' },
  { id: 'examine', label: 'Examine' },
  { id: 'research', label: 'Research' },
  { id: 'images', label: 'Images' },
  { id: 'inventory', label: 'Inventory' },
]

function plural(count: number, one: string, many: string) {
  return count === 1 ? one : many
}

type StepWork = { questions: number; failed: number }
type StepAttempts = StepWork & { jobs: number; ready: number; running: number }

/** A failed attempt outranks a question, so the badge turns to the stronger tone. */
function processingBadge({ questions, failed }: StepWork): Pick<TabItem, 'badge'> {
  const parts = [
    questions > 0 ? `${questions} ${plural(questions, 'question', 'questions')}` : '',
    failed > 0 ? `${failed} failed` : '',
  ].filter(Boolean)
  if (parts.length === 0) {
    return {}
  }

  return {
    badge: {
      label: parts.join(' · '),
      short: String(questions + failed),
      tone: failed > 0 ? 'bad' : 'warn',
    },
  }
}

function primaryTabs(batchId: string, attention: BatchAttentionDto | undefined): TabItem[] {
  const review = attention?.review
  const changes = attention?.changes
  const changeProblems = (changes?.failed ?? 0) + (changes?.uncertain ?? 0)

  return [
    { id: 'capture', label: 'Capture', href: batchHref(batchId, { tab: 'capture' }) },
    {
      id: 'processing',
      label: 'Processing',
      href: batchHref(batchId, { tab: 'processing', step: 'overview' }),
      spinner: (attention?.processing.running ?? 0) > 0,
      ...processingBadge(attention?.processing ?? { questions: 0, failed: 0 }),
    },
    {
      id: 'review',
      label: 'Review',
      href: batchHref(batchId, { tab: 'review', view: 'lots' }),
      ...(review ? { count: review.to_check, countLabel: 'to check' } : {}),
      ...(review && review.to_decide > 0
        ? {
            badge: {
              label: `${review.to_decide} to decide`,
              short: String(review.to_decide),
              tone: 'warn',
            },
          }
        : {}),
    },
    {
      id: 'changes',
      label: 'Changes',
      href: batchHref(batchId, { tab: 'changes', view: 'ready' }),
      ...(changes ? { count: changes.ready, countLabel: 'ready', countTone: 'ok' } : {}),
      ...(changeProblems > 0
        ? {
            badge: {
              label: `${changeProblems} to check`,
              short: String(changeProblems),
              tone: 'bad',
            },
          }
        : {}),
    },
  ]
}

function processingRow(batchId: string, attention: BatchAttentionDto | undefined): TabItem[] {
  const processing = attention?.processing

  return STEPS.map(({ id, label }) => {
    const href = batchHref(batchId, { tab: 'processing', step: id })
    if (id === 'overview') {
      return { id, label, href, ...processingBadge(processing ?? { questions: 0, failed: 0 }) }
    }
    const step: StepAttempts = processing?.steps[id] ?? {
      questions: 0,
      failed: 0,
      jobs: 0,
      ready: 0,
      running: 0,
    }
    return {
      id,
      label,
      href,
      spinner: step.running > 0,
      ...(step.jobs > 0 ? { progress: { ready: step.ready, of: step.jobs } } : {}),
      ...processingBadge(step),
    }
  })
}

function reviewRow(batchId: string, attention: BatchAttentionDto | undefined): TabItem[] {
  const review = attention?.review

  return [
    {
      id: 'lots',
      label: 'Lots',
      href: batchHref(batchId, { tab: 'review', view: 'lots' }),
      ...(review ? { count: review.to_check, countLabel: 'to check' } : {}),
    },
    { id: 'map', label: 'Map', href: batchHref(batchId, { tab: 'review', view: 'map' }) },
    {
      id: 'records',
      label: 'Records',
      href: batchHref(batchId, { tab: 'review', view: 'records' }),
      ...(review && review.to_decide > 0
        ? {
            badge: {
              label: `${review.to_decide} to decide`,
              short: String(review.to_decide),
              tone: 'warn',
            },
          }
        : {}),
    },
  ]
}

function changesRow(batchId: string, attention: BatchAttentionDto | undefined): TabItem[] {
  const changes = attention?.changes
  const problems = (changes?.failed ?? 0) + (changes?.uncertain ?? 0)

  return [
    {
      id: 'ready',
      label: 'Ready to add',
      href: batchHref(batchId, { tab: 'changes', view: 'ready' }),
      ...(changes ? { count: changes.ready, countLabel: 'ready' } : {}),
    },
    {
      id: 'added',
      label: 'Added',
      href: batchHref(batchId, { tab: 'changes', view: 'added' }),
      ...(problems > 0
        ? { badge: { label: `${problems} to check`, short: String(problems), tone: 'bad' } }
        : {}),
    },
  ]
}

function secondRow(batchId: string, route: BatchRoute, attention: BatchAttentionDto | undefined) {
  switch (route.tab) {
    case 'processing':
      return {
        label: 'Processing steps',
        items: processingRow(batchId, attention),
        current: route.step,
      }
    case 'review':
      return { label: 'Review views', items: reviewRow(batchId, attention), current: route.view }
    case 'changes':
      return { label: 'Changes views', items: changesRow(batchId, attention), current: route.view }
    default:
      return null
  }
}

/** The batch's title, its four tabs and their sub-views, and what needs the operator. */
export function BatchHeader({
  batch,
  route,
  attention,
  attentionUnavailable = false,
  activeLotCount,
  retiredLotCount,
  busy,
  onArchive,
}: BatchHeaderProps) {
  const current: BatchTab = route.tab
  const row = secondRow(batch.id, route, attention)
  const width = route.tab === 'review' ? 'review' : 'content'

  return (
    <Band>
      <Inner $width={width}>
        <Lead>
          <TitleLine>
            <Title>{batch.title}</Title>
            {attention && <NeedsYouPanel attention={attention} />}
            {!attention && attentionUnavailable && (
              <Pill tone="neutral">Needs you unavailable</Pill>
            )}
            <Button variant="ghost" size="sm" disabled={busy} onClick={onArchive}>
              {batch.archived ? 'Resume archived batch' : 'Archive batch'}
            </Button>
          </TitleLine>
          <Meta>
            {[
              `${activeLotCount} ${plural(activeLotCount, 'lot', 'lots')}${retiredLotCount > 0 ? ` (${retiredLotCount} retired)` : ''}`,
              attention && `${attention.review.to_check} ready to check`,
              attention && `${attention.changes.ready} ready to add`,
              attention &&
                attention.processing.running > 0 &&
                `${attention.processing.running} ${plural(attention.processing.running, 'agent', 'agents')} working`,
              batch.archived && 'Archived',
            ]
              .filter(Boolean)
              .join(' · ')}
          </Meta>
        </Lead>
        <TabSlot>
          <Tabs label="Batch" items={primaryTabs(batch.id, attention)} current={current} />
        </TabSlot>
      </Inner>
      {row && (
        <SubBand>
          <SubInner $width={width}>
            <TabSlot>
              <SubTabs label={row.label} items={row.items} current={row.current} />
            </TabSlot>
          </SubInner>
        </SubBand>
      )}
    </Band>
  )
}

/** A full-width band under the masthead; its rows line up with the page's content width. */
const Band = styled.header`
  background: ${color.surface};
  border-bottom: 1px solid ${color.line};
`

const Inner = styled.div<{ $width: 'content' | 'review' }>`
  display: flex;
  flex-wrap: wrap;
  align-items: flex-end;
  gap: ${space[4]} ${space[8]};
  max-width: ${({ $width }) => pageWidth[$width]};
  margin: 0 auto;
  padding: ${space[7]} ${space[12]} 0;
  ${media.compact} {
    padding: ${space[6]} ${space[8]} 0;
  }
`

const Lead = styled.div`
  display: flex;
  flex: 1 1 320px;
  flex-direction: column;
  gap: ${space[3]};
  min-width: 0;
  padding-bottom: ${space[5]};
`

const TitleLine = styled.div`
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: ${space[4]};
`

const Title = styled.h1`
  margin: 0;
  ${type.h1}
  overflow-wrap: anywhere;
`

const Meta = styled.p`
  margin: 0;
  font-size: ${typeVar.small.size};
  color: ${color.muted};
`

/** The band draws the rules, so the tab rows drop their own. */
const TabSlot = styled.div`
  min-width: 0;
  max-width: 100%;
  > nav {
    border-bottom: 0;
  }
  /* At phone width the rows run into the band's padding, as on the canvas, to fit four tabs. */
  ${media.compact} {
    max-width: none;
    margin-inline: calc(-1 * ${space[8]});
    > nav {
      padding-inline: ${space[4]};
    }
  }
`

const SubBand = styled.div`
  border-top: 1px solid ${color.line};
`

const SubInner = styled.div<{ $width: 'content' | 'review' }>`
  max-width: ${({ $width }) => pageWidth[$width]};
  margin: 0 auto;
  padding: 0 ${space[12]};
  ${media.compact} {
    padding: 0 ${space[8]};
  }
`
