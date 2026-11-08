import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import styled from 'styled-components'
import type {
  CaptureSnapshotDto,
  ManualPreviewDto,
  ManualWorkspaceDto,
  PreparationNodeDto,
  PreparationTreeDto,
} from '@invimport/contracts'
import {
  byType,
  categoryTree,
  leftOutLots,
  locationTree,
  previewNodes,
  readyLotIds,
  STATE_LABELS,
  summary,
} from '../../changes/model'
import { MAX_SELECTED_LOTS } from '../../manual/types'
import { batchHref } from '../../navigation/batch-route'
import { reviewHash } from '../../operator/review-model'
import { serverQueryKey, useServerScope } from '../../queries/scope'
import { color, radius, size, space } from '../../theme/generated/tokens'
import { Banner } from '../ui/Banner'
import { Button } from '../ui/Button'
import { ChangeSummary } from '../ui/ChangeSummary'
import { SegmentedControl } from '../ui/SegmentedControl'
import { StickyFooter } from '../ui/StickyFooter'
import { TargetChip } from '../ui/TargetChip'
import { Heading, Label, Link, Panel, Paragraph, Select, Small, Summary } from '../ui/primitives'
import { PreparationTreeView } from './PreparationTreeView'
import { RecordStatePill } from '../ui/RecordStatePill'
import { media } from '../ui/media'
import { lotCrops } from '../../processing/proposed-lots'

interface Props {
  batch: CaptureSnapshotDto
  workspace: ManualWorkspaceDto
  preview: ManualPreviewDto | null
  pinnedPreparationId?: string
  busy: boolean
  choose: (preview: ManualPreviewDto) => void
  /** Prepares exactly these lots; the new preparation is then shown. */
  prepareLots: (lotIds: string[]) => void
  approve: () => void
  readTree?: (preparationId: string) => Promise<PreparationTreeDto>
}

/** Changes › Ready to add: reviewed lots, what will change, and one approval of exactly that. */
export function ReadyToAdd({
  batch,
  workspace,
  preview,
  pinnedPreparationId,
  busy,
  choose,
  prepareLots,
  approve,
  readTree,
}: Props) {
  const scope = useServerScope()
  const [view, setView] = useState<'type' | 'tree'>('type')
  const [grouping, setGrouping] = useState<'category' | 'location'>('category')
  // The operator's ticks; null follows the shown preparation (or every ready lot before one).
  const [chosen, setChosen] = useState<string[] | null>(null)
  const [chosenFor, setChosenFor] = useState(preview?.id)
  if (chosenFor !== preview?.id) {
    setChosenFor(preview?.id)
    setChosen(null)
  }
  const treeQuery = useQuery({
    queryKey: serverQueryKey(scope, 'preparation-tree', preview?.id ?? ''),
    queryFn: () => readTree!(preview!.id),
    enabled: preview !== null && readTree !== undefined,
    // A preparation never changes, so its tree is read once.
    staleTime: Infinity,
  })
  const current =
    preview !== null && workspace.preparations.some((value) => value.id === preview.id)
  const tree = treeQuery.data?.preparation_id === preview?.id ? treeQuery.data : undefined
  const nodes: PreparationNodeDto[] = tree?.nodes ?? (preview ? previewNodes(preview) : [])
  const counts = summary(nodes)

  // A current preparation's lots stay listed; a stale one's count only if still ready.
  const ready = [
    ...new Set([...(current ? preview.selected_lot_ids : []), ...readyLotIds(workspace)]),
  ]
  // A ticked lot that is no longer ready drops out, so it is never sent or counted.
  const ticked = (chosen ?? preview?.selected_lot_ids ?? ready.slice(0, MAX_SELECTED_LOTS)).filter(
    (lot) => ready.includes(lot),
  )
  const untickedAll = ticked.length === 0
  // Approval waits while the shown preparation is not exactly the ticked lots.
  const matches =
    preview !== null &&
    ticked.length === preview.selected_lot_ids.length &&
    ticked.every((lot) => preview.selected_lot_ids.includes(lot))
  const leftOut = leftOutLots(workspace)

  const lotLabel = (id: string) => batch.lots.find((lot) => lot.id === id)?.label ?? 'Another lot'

  const lotHref = (id: string) => batchHref(batch.id, { tab: 'review', view: 'lots', lotId: id })

  const hrefFor = (node: PreparationNodeDto) =>
    node.lot_id
      ? lotHref(node.lot_id)
      : node.part_subject_id
        ? batchHref(batch.id, {
            tab: 'review',
            view: 'records',
            recordType: 'part',
            recordId: node.part_subject_id,
          })
        : undefined

  function toggle(id: string) {
    const next = ticked.includes(id) ? ticked.filter((value) => value !== id) : [...ticked, id]
    setChosen(next)
    if (preview && next.length > 0) {
      prepareLots(next)
    }
  }

  const approvable = !busy && current && matches && !batch.archived
  const lots = preview?.effects.length ?? 0

  return (
    <Layout data-columns="two">
      {pinnedPreparationId && !current && (
        <Banner tone="warn">
          This preparation is no longer current: it is stale or already approved, and no other has
          been put in its place. Choose a current one, or change the lots below.
        </Banner>
      )}
      <Panel aria-labelledby="ready-lots">
        <Heading id="ready-lots">Lots to add</Heading>
        {ready.length === 0 ? (
          <Paragraph>No reviewed lots are ready. Review lots in Review › Lots first.</Paragraph>
        ) : (
          <>
            <Small>
              Up to {MAX_SELECTED_LOTS} lots at a time. Changing the lots prepares them again.
            </Small>
            <LotRows>
              {ready.map((id) => {
                const lot = batch.lots.find((value) => value.id === id)
                const cover = lot ? lotCrops(batch, lot, { width: 34, height: 34 })[0] : undefined
                const effect = preview?.effects.find((value) => value.lot_id === id)
                return (
                  <LotRow key={id}>
                    <input
                      type="checkbox"
                      aria-label={lotLabel(id)}
                      checked={ticked.includes(id)}
                      disabled={
                        busy || (!ticked.includes(id) && ticked.length >= MAX_SELECTED_LOTS)
                      }
                      onChange={() => toggle(id)}
                    />
                    <Thumb data-thumb aria-hidden="true">
                      {cover ? (
                        <img {...cover} loading="lazy" decoding="async" alt="" />
                      ) : (
                        <span>▧</span>
                      )}
                    </Thumb>
                    <LotText>
                      <strong>{lotLabel(id)}</strong>
                      {effect && (
                        <Small>
                          {effect.quantity} pcs · {effect.location_label ?? 'No location'}
                        </Small>
                      )}
                    </LotText>
                  </LotRow>
                )
              })}
            </LotRows>
            {untickedAll && <Small role="status">Tick at least one lot to add.</Small>}
            {(!matches || !current) && ticked.length > 0 && (preview === null || !busy) && (
              <Button disabled={busy} onClick={() => prepareLots(ticked)}>
                Show what will change
              </Button>
            )}
          </>
        )}
        {leftOut.length > 0 && (
          <>
            <SectionHeading as="h3">Left out</SectionHeading>
            <ul>
              {leftOut.map((lot) => (
                <li key={lot.lotId}>
                  <Link
                    href={reviewHash(batch.id, {
                      lotId: lot.lotId,
                      view: 'evidence',
                      filter: lot.filter,
                    })}
                  >
                    {lotLabel(lot.lotId)}
                  </Link>{' '}
                  <Small>{lot.reason}</Small>
                </li>
              ))}
            </ul>
          </>
        )}
        {(workspace.preparations.length > 1 || (workspace.preparations.length > 0 && !current)) && (
          <Label>
            Prepared selection
            <Select
              value={current ? preview.id : ''}
              onChange={(event) => {
                const value = workspace.preparations.find((item) => item.id === event.target.value)
                if (value) {
                  choose(value)
                }
              }}
            >
              <option value="">Choose a prepared selection</option>
              {workspace.preparations.map((value) => (
                <option key={value.id} value={value.id}>
                  {value.effects.map((effect) => effect.lot_label).join(', ')}
                </option>
              ))}
            </Select>
          </Label>
        )}
      </Panel>
      <Panel aria-labelledby="what-will-change">
        <HeadRow>
          <div>
            <Heading id="what-will-change">What will change in InvenTree</Heading>
            {preview && (
              <Small>
                {counts.new} new · {counts.update} update to InvenTree
              </Small>
            )}
          </div>
          {preview && (
            <Controls>
              <SegmentedControl
                label="View"
                options={[
                  { id: 'type', label: 'By type' },
                  ...(tree?.nodes ? [{ id: 'tree', label: 'Tree' }] : []),
                ]}
                value={view === 'tree' && tree?.nodes ? 'tree' : 'type'}
                onChange={(id) => setView(id as 'type' | 'tree')}
              />
              {view === 'tree' && tree?.nodes && (
                <SegmentedControl
                  label="Group by"
                  options={[
                    { id: 'category', label: 'Category' },
                    { id: 'location', label: 'Location' },
                  ]}
                  value={grouping}
                  onChange={(id) => setGrouping(id as 'category' | 'location')}
                />
              )}
            </Controls>
          )}
        </HeadRow>
        {!preview ? (
          <Paragraph>Nothing is prepared yet.</Paragraph>
        ) : (
          <>
            {treeQuery.isPending && readTree && <Small role="status">Reading every record…</Small>}
            {(treeQuery.isError || tree?.nodes === null) && (
              <Small>The full list isn’t available, so only stock, Parts and locations show.</Small>
            )}
            {view === 'tree' && tree?.nodes ? (
              <PreparationTreeView
                label={grouping === 'category' ? 'By category' : 'By location'}
                items={
                  grouping === 'category' ? categoryTree(tree.nodes) : locationTree(tree.nodes)
                }
              />
            ) : (
              <ChangeSummary
                sections={byType(nodes).map((section) => ({
                  title: section.title,
                  count: section.nodes.length,
                  items: section.nodes.map((node) => ({
                    id: node.key,
                    label: node.label,
                    href: hrefFor(node),
                    pill: (
                      <RecordStatePill state={node.state}>
                        {STATE_LABELS[node.state]}
                      </RecordStatePill>
                    ),
                    detail: node.detail ?? undefined,
                  })),
                }))}
              />
            )}
            <details>
              <Summary>Exact approval binding</Summary>
              <Binding>
                <Small>Plan {preview.plan_sha256}</Small>
                <Small>Review {preview.review_fingerprint}</Small>
                {preview.effects.map((effect) => (
                  <Small key={effect.lot_id}>
                    {effect.lot_label}: {effect.barcode}
                  </Small>
                ))}
              </Binding>
            </details>
          </>
        )}
      </Panel>
      <StickyFooter
        label="Approve"
        leading={<TargetChip>Test InvenTree</TargetChip>}
        summary={
          preview ? (
            <Small>
              {counts.new} new · {counts.update} update · adds to the owned test target only
            </Small>
          ) : (
            <Small>Nothing prepared</Small>
          )
        }
        primary={
          <Button variant="primary" size="lg" disabled={!approvable} onClick={approve}>
            Approve {lots} {lots === 1 ? 'lot' : 'lots'} and add to InvenTree
          </Button>
        }
      />
    </Layout>
  )
}

/** Lots beside what will change; one column below bp-stacked. */
const Layout = styled.div`
  display: grid;
  grid-template-columns: minmax(0, 0.9fr) minmax(0, 1.1fr);
  gap: ${space[6]};
  align-items: start;
  > :not(section) {
    grid-column: 1 / -1;
  }
  ${media.stacked} {
    grid-template-columns: minmax(0, 1fr);
  }
`
const LotRows = styled.div`
  display: grid;
  margin: ${space[4]} 0;
`
const LotRow = styled.label`
  display: grid;
  grid-template-columns: auto auto minmax(0, 1fr);
  align-items: center;
  gap: ${space[5]};
  padding: ${space[6]} 0;
  border-top: 1px solid ${color.line};
  cursor: pointer;
  ${media.compact} {
    min-height: ${size.touch};
  }
`
const Thumb = styled.span`
  display: grid;
  place-items: center;
  /* literal-allowed: the canvas's 34px lot-row thumbnail; no thumbnail size token */
  width: 34px;
  height: 34px;
  overflow: hidden;
  border: 1px solid ${color.line};
  border-radius: ${radius.thumb};
  background: ${color.photoStage};
  color: ${color.photoFg};
  img {
    display: block;
    width: 100%;
    height: 100%;
    object-fit: cover;
  }
`
const LotText = styled.span`
  display: grid;
  min-width: 0;
  overflow-wrap: anywhere;
`
const SectionHeading = styled(Heading)`
  margin-top: ${space[6]};
`
const HeadRow = styled.div`
  display: flex;
  flex-wrap: wrap;
  justify-content: space-between;
  align-items: flex-start;
  gap: ${space[4]};
`
const Controls = styled.div`
  display: flex;
  flex-wrap: wrap;
  gap: ${space[4]};
`
const Binding = styled.div`
  display: grid;
  gap: ${space[2]};
  overflow-wrap: anywhere;
`
