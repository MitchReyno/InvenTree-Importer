import type { BatchAttentionDto, CaptureSnapshotDto } from '@invimport/contracts'
import styled from 'styled-components'
import {
  batchHref,
  type BatchRoute,
  type BatchTab,
  type ProcessingStep,
} from '../../navigation/batch-route'
import { color, radius, space, type } from '../../theme/generated/tokens'
import { Button } from '../ui/Button'
import { media } from '../ui/media'
import { SubTabs, Tabs, type TabItem } from '../ui/Tabs'
import { Pill } from '../ui/Pill'
import { NeedYouPanel } from './NeedYouPanel'

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

/** A failed attempt outranks a question, so the badge turns to the stronger tone. */
function processingBadge({ questions, failed }: StepWork): Pick<TabItem, 'badge'> {
  const parts = [
    questions > 0 ? `${questions} ${plural(questions, 'question', 'questions')}` : '',
    failed > 0 ? `${failed} failed` : '',
  ].filter(Boolean)
  if (parts.length === 0) {
    return {}
  }

  return { badge: { label: parts.join(' · '), tone: failed > 0 ? 'bad' : 'warn' } }
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
      ...processingBadge(attention?.processing ?? { questions: 0, failed: 0 }),
    },
    {
      id: 'review',
      label: 'Review',
      href: batchHref(batchId, { tab: 'review', view: 'lots' }),
      ...(review ? { count: review.to_check, countLabel: 'to check' } : {}),
      ...(review && review.to_decide > 0
        ? { badge: { label: `${review.to_decide} to decide`, tone: 'warn' } }
        : {}),
    },
    {
      id: 'changes',
      label: 'Changes',
      href: batchHref(batchId, { tab: 'changes', view: 'ready' }),
      ...(changes ? { count: changes.ready, countLabel: 'ready' } : {}),
      ...(changeProblems > 0
        ? { badge: { label: `${changeProblems} to check`, tone: 'bad' } }
        : {}),
    },
  ]
}

function processingRow(batchId: string, attention: BatchAttentionDto | undefined): TabItem[] {
  const processing = attention?.processing

  return STEPS.map(({ id, label }) => {
    const work = (id === 'overview' ? processing : processing?.steps[id]) ?? {
      questions: 0,
      failed: 0,
    }
    return {
      id,
      label,
      href: batchHref(batchId, { tab: 'processing', step: id }),
      ...processingBadge(work),
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
        ? { badge: { label: `${review.to_decide} to decide`, tone: 'warn' } }
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
      ...(problems > 0 ? { badge: { label: `${problems} to check`, tone: 'bad' } } : {}),
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

  return (
    <Band>
      <TitleRow>
        <div>
          <Title>{batch.title}</Title>
          <Meta>
            {activeLotCount} {plural(activeLotCount, 'lot', 'lots')}
            {retiredLotCount > 0 && ` (${retiredLotCount} retired)`} · {batch.parts.length}{' '}
            {plural(batch.parts.length, 'Part proposal', 'Part proposals')}
            {batch.archived && ' · Archived'}
          </Meta>
        </div>
        <Actions>
          {attention && <NeedYouPanel attention={attention} />}
          {!attention && attentionUnavailable && <Pill tone="neutral">Needs you unavailable</Pill>}
          <Button variant="ghost" size="sm" disabled={busy} onClick={onArchive}>
            {batch.archived ? 'Resume archived batch' : 'Archive batch'}
          </Button>
        </Actions>
      </TitleRow>
      <Tabs label="Batch" items={primaryTabs(batch.id, attention)} current={current} />
      {row && <SubTabs label={row.label} items={row.items} current={row.current} />}
    </Band>
  )
}

const Band = styled.header`
  display: grid;
  gap: ${space[4]};
  margin-bottom: ${space[9]};
  padding: ${space[7]} ${space[8]} 0;
  border: 1px solid ${color.line};
  border-radius: ${radius.card};
  background: ${color.surface};
  ${media.compact} {
    padding: ${space[6]} ${space[6]} 0;
  }
`

const TitleRow = styled.div`
  display: flex;
  flex-wrap: wrap;
  align-items: flex-start;
  justify-content: space-between;
  gap: ${space[6]};
  > div:first-child {
    min-width: 0;
  }
`

const Title = styled.h1`
  margin: 0;
  ${type.h1}
  overflow-wrap: anywhere;
`

const Meta = styled.p`
  margin: ${space[2]} 0 0;
  font-size: 12.5px;
  color: ${color.muted};
`

const Actions = styled.div`
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: ${space[4]};
`
