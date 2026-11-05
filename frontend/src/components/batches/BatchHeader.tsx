import type { BatchAttentionDto, CaptureSnapshotDto } from '@invimport/contracts'
import styled from 'styled-components'
import {
  batchHref,
  processingStepFor,
  type BatchRoute,
  type BatchTab,
  type ProcessingStep,
} from '../../navigation/batch-route'
import { color, radius, space, type } from '../../theme/generated/tokens'
import { Button } from '../ui/Button'
import { media } from '../ui/media'
import { SubTabs, Tabs, type TabItem } from '../ui/Tabs'
import { NeedYouPanel } from './NeedYouPanel'

type BatchHeaderProps = {
  batch: CaptureSnapshotDto
  route: BatchRoute
  attention: BatchAttentionDto | undefined
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

/** Open questions per Processing step, read from the routes of the attention items. */
function questionsByStep(attention: BatchAttentionDto | undefined) {
  const counts = new Map<ProcessingStep, number>()
  for (const item of attention?.items ?? []) {
    if (item.group !== 'question') {
      continue
    }
    const step = processingStepFor(item.route.split('/')[2] ?? '')
    counts.set(step, (counts.get(step) ?? 0) + 1)
  }

  return counts
}

function primaryTabs(batchId: string, attention: BatchAttentionDto | undefined): TabItem[] {
  const questions = attention?.processing.questions ?? 0
  const review = attention?.review
  const changes = attention?.changes
  const changeProblems = (changes?.failed ?? 0) + (changes?.uncertain ?? 0)

  return [
    { id: 'capture', label: 'Capture', href: batchHref(batchId, { tab: 'capture' }) },
    {
      id: 'processing',
      label: 'Processing',
      href: batchHref(batchId, { tab: 'processing', step: 'overview' }),
      ...(questions > 0
        ? {
            badge: {
              label: `${questions} ${plural(questions, 'question', 'questions')}`,
              tone: 'warn',
            },
          }
        : {}),
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
  const counts = questionsByStep(attention)

  return STEPS.map(({ id, label }) => {
    const open = id === 'overview' ? (attention?.processing.questions ?? 0) : (counts.get(id) ?? 0)
    return {
      id,
      label,
      href: batchHref(batchId, { tab: 'processing', step: id }),
      ...(open > 0
        ? { badge: { label: `${open} ${plural(open, 'question', 'questions')}`, tone: 'warn' } }
        : {}),
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
    // The Map arrives with the Review redesign; until then it is shown but not linked.
    {
      id: 'map',
      label: 'Map',
      href: batchHref(batchId, { tab: 'review', view: 'map' }),
      disabled: true,
    },
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
  gap: ${space[2]};
  margin-bottom: ${space['4-5']};
  padding: ${space['3-5']} ${space[4]} 0;
  border: 1px solid ${color.line};
  border-radius: ${radius.card};
  background: ${color.surface};
  ${media.compact} {
    padding: ${space[3]} ${space[3]} 0;
  }
`

const TitleRow = styled.div`
  display: flex;
  flex-wrap: wrap;
  align-items: flex-start;
  justify-content: space-between;
  gap: ${space[3]};
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
  margin: ${space[1]} 0 0;
  font-size: 12.5px;
  color: ${color.muted};
`

const Actions = styled.div`
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: ${space[2]};
`
