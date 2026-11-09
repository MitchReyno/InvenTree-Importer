import { useLayoutEffect, useRef } from 'react'
import type { BatchAttentionDto, CaptureSnapshotDto } from '@invimport/contracts'
import styled from 'styled-components'
import { batchHref, type BatchRoute, type ProcessingStep } from '#/navigation/batch-route'
import { stepStatus, tabCount, type TabCountInput, type TabKey } from '#/attention/tab-count'
import { color, pageWidth, shadow, space, type, typeVar, zIndex } from '#/theme/generated/tokens'
import {
  BackIcon,
  Button,
  IconButton,
  media,
  SubTabs,
  Tabs,
  type TabItem,
  Pill,
  linkTouchArea,
  useMediaQuery,
} from '#/components/ui'
import { useCompactStatus } from '#/components/masthead/CompactStatus'
import { useOutOfView } from '#/browser/useOutOfView'
import { NeedsYouPanel } from './NeedsYouPanel'

type BatchHeaderProps = {
  batch: CaptureSnapshotDto
  route: BatchRoute
  attention: BatchAttentionDto | undefined
  /** The attention read failed, so the header cannot say what needs the operator. */
  attentionUnavailable?: boolean
  /** The Map's unused files, from the media read; absent while it or lot lineage is unknown. */
  unusedFiles?: number
  /** Lots retired by a split or merge stay in the snapshot; counts show active lots. */
  activeLotCount: number
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

/** A tab or sub-tab: its id is the last part of its key ("review/lots" → "lots"). */
function tab(key: TabKey, label: string, href: string, input: TabCountInput): TabItem {
  return { id: key.slice(key.lastIndexOf('/') + 1), label, href, count: tabCount(key, input) }
}

function primaryTabs(batchId: string, input: TabCountInput): TabItem[] {
  const running = (input.attention?.processing.running ?? 0) > 0
  const processing = tab(
    'processing',
    'Processing',
    batchHref(batchId, { tab: 'processing', step: 'overview' }),
    input,
  )

  return [
    tab('capture', 'Capture', batchHref(batchId, { tab: 'capture' }), input),
    running ? { ...processing, status: 'running' } : processing,
    tab('review', 'Review', batchHref(batchId, { tab: 'review', view: 'lots' }), input),
    tab('changes', 'Changes', batchHref(batchId, { tab: 'changes', view: 'ready' }), input),
  ]
}

function processingRow(batchId: string, input: TabCountInput): TabItem[] {
  return STEPS.map(({ id, label }) => {
    const item = tab(
      `processing/${id}`,
      label,
      batchHref(batchId, { tab: 'processing', step: id }),
      input,
    )
    const status = id === 'overview' ? undefined : stepStatus(id, input.attention)

    return status ? { ...item, status } : item
  })
}

const REVIEW_VIEWS = [
  { view: 'lots', label: 'Lots' },
  { view: 'map', label: 'Map' },
  { view: 'records', label: 'Records' },
] as const

function reviewRow(batchId: string, input: TabCountInput): TabItem[] {
  return REVIEW_VIEWS.map(({ view, label }) =>
    tab(`review/${view}`, label, batchHref(batchId, { tab: 'review', view }), input),
  )
}

function changesRow(batchId: string, input: TabCountInput): TabItem[] {
  return [
    tab(
      'changes/ready',
      'Ready to add',
      batchHref(batchId, { tab: 'changes', view: 'ready' }),
      input,
    ),
    tab('changes/added', 'Added', batchHref(batchId, { tab: 'changes', view: 'added' }), input),
  ]
}

function secondRow(batchId: string, route: BatchRoute, input: TabCountInput) {
  switch (route.tab) {
    case 'processing':
      return {
        label: 'Processing steps',
        items: processingRow(batchId, input),
        current: route.step,
      }
    case 'review':
      return { label: 'Review views', items: reviewRow(batchId, input), current: route.view }
    case 'changes':
      return { label: 'Changes views', items: changesRow(batchId, input), current: route.view }
    default:
      return null
  }
}

/**
 * Moves focus from a control in the condensed row to the same control elsewhere (the full header
 * first, then the masthead), so it is not lost when the row goes. Controls match by their
 * `data-focus-key` or, for links, their address.
 */
function handFocusBack(row: HTMLElement | null) {
  const active = document.activeElement
  if (!row || !(active instanceof HTMLElement) || !row.contains(active)) {
    return
  }
  const key = active.dataset.focusKey
  const href = active.getAttribute('href')
  let selector = ''
  if (key) {
    selector = `[data-focus-key="${CSS.escape(key)}"]`
  } else if (href !== null) {
    selector = `a[href="${CSS.escape(href)}"]`
  }
  if (!selector) {
    return
  }

  const elsewhere = (scope: ParentNode) =>
    [...scope.querySelectorAll<HTMLElement>(selector)].find((element) => !row.contains(element))

  const target = (row.parentElement && elsewhere(row.parentElement)) ?? elsewhere(document)
  target?.focus()
}

/** "12 lots · 6 ready to add": the tabs and the need-you pill carry everything else. */
function summary(batch: CaptureSnapshotDto, activeLotCount: number, attention?: BatchAttentionDto) {
  return [
    `${activeLotCount} ${plural(activeLotCount, 'lot', 'lots')}`,
    attention && `${attention.changes.ready} ready to add`,
    batch.archived && 'Archived',
  ]
    .filter(Boolean)
    .join(' · ')
}

/**
 * The batch's title, its need-you pill and short summary, then its four tabs and their sub-views.
 * At phone width, once the header scrolls away, a fixed row condenses it: back, title, need-you
 * count, the masthead's compact status and menu, with the sub-tabs below.
 */
export function BatchHeader({
  batch,
  route,
  attention,
  attentionUnavailable = false,
  unusedFiles,
  activeLotCount,
  busy,
  onArchive,
}: BatchHeaderProps) {
  const input: TabCountInput = { attention, activeLotCount, unusedFiles }
  const row = secondRow(batch.id, route, input)
  const width = route.tab === 'review' ? 'review' : 'content'
  const phone = useMediaQuery(media.compact)
  const condensed = useRef<HTMLElement>(null)
  const header = useOutOfView(phone, () => handFocusBack(condensed.current))
  const compactStatus = useCompactStatus()

  // While the fixed row shows, focused content scrolls clear of it.
  useLayoutEffect(() => {
    const row = condensed.current
    if (!header.outOfView || !row) {
      return
    }
    const root = document.documentElement
    root.style.scrollPaddingTop = `${row.offsetHeight}px`

    return () => {
      root.style.scrollPaddingTop = ''
    }
  }, [header.outOfView])

  return (
    <Band ref={header.ref}>
      <Inner $width={width}>
        <BackLink href="#" data-focus-key="back">
          <span aria-hidden="true">←</span> Batches
        </BackLink>
        <TitleLine>
          <Title>{batch.title}</Title>
          {attention && <NeedsYouPanel attention={attention} />}
          {!attention && attentionUnavailable && <Pill tone="neutral">Needs you unavailable</Pill>}
          <Meta>{summary(batch, activeLotCount, attention)}</Meta>
          <Spacer />
          <Button variant="ghost" size="sm" disabled={busy} onClick={onArchive}>
            {batch.archived ? 'Resume archived batch' : 'Archive batch'}
          </Button>
        </TitleLine>
        <TabSlot $level="primary">
          <Tabs label="Batch" items={primaryTabs(batch.id, input)} current={route.tab} />
        </TabSlot>
      </Inner>
      {row && (
        <SubBand>
          <SubInner $width={width}>
            <TabSlot $level="secondary">
              <SubTabs label={row.label} items={row.items} current={row.current} />
            </TabSlot>
          </SubInner>
        </SubBand>
      )}
      {header.outOfView && (
        <Condensed ref={condensed} aria-label="Batch, condensed">
          <CondensedRow>
            <IconButton
              href="#"
              label="Back to batches"
              icon={<BackIcon />}
              data-focus-key="back"
            />
            <CondensedTitle title={batch.title}>{batch.title}</CondensedTitle>
            {attention && <NeedsYouPanel attention={attention} compact />}
            {compactStatus}
          </CondensedRow>
          {row && (
            <SubTabs
              label={`${row.label}, condensed`}
              items={row.items}
              current={row.current}
              announceCurrent={false}
            />
          )}
        </Condensed>
      )}
    </Band>
  )
}

/** A full-width band under the masthead; its rows line up with the page's content width. */
const Band = styled.header`
  background: ${color.surface};
  border-bottom: 1px solid ${color.line};
`

/** Title line first, then the tabs on their own row under it. */
const Inner = styled.div<{ $width: 'content' | 'review' }>`
  display: flex;
  flex-direction: column;
  gap: ${space[3]};
  max-width: ${({ $width }) => pageWidth[$width]};
  margin: 0 auto;
  padding: ${space[7]} ${space[12]} 0;
  ${media.compact} {
    padding: ${space[6]} ${space[8]} 0;
  }
`

/** At phone width the masthead drops its trail, so the way back sits above the title. */
const BackLink = styled.a`
  display: none;
  align-self: flex-start;
  font-size: ${typeVar.small.size};
  color: ${color.accent};
  text-decoration: none;
  ${linkTouchArea}
  ${media.compact} {
    display: inline-flex;
    align-items: center;
    gap: ${space[2]};
  }
`

const TitleLine = styled.div`
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: ${space[3]} ${space[6]};
`

const Spacer = styled.span`
  flex: 1;
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

/** Each tab's horizontal padding, so a row can shift left by it and its labels line up with the title. */
const TAB_INSET = { primary: space[6], secondary: space[5] }

/** The band draws the rules, so the tab rows drop their own. */
const TabSlot = styled.div<{ $level: keyof typeof TAB_INSET }>`
  min-width: 0;
  max-width: calc(100% + ${({ $level }) => TAB_INSET[$level]});
  margin-left: calc(-1 * ${({ $level }) => TAB_INSET[$level]});
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

/** Fixed rather than sticky, so showing it never shifts the page it covers. */
const Condensed = styled.section`
  position: fixed;
  inset: 0 0 auto;
  z-index: ${zIndex.raised};
  background: ${color.surface};
  border-bottom: 1px solid ${color.line};
  box-shadow: ${shadow};
  > nav {
    padding-inline: ${space[2]};
    border-bottom: 0;
  }
`

const CondensedRow = styled.div`
  display: flex;
  align-items: center;
  gap: ${space[2]};
  padding: ${space[2]} ${space[2]} 0;
`

const CondensedTitle = styled.b`
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
`
