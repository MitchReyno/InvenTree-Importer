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
import { batchHref } from '../../navigation/batch-route'
import { reviewHash } from '../../operator/review-model'
import { serverQueryKey, useServerScope } from '../../queries/scope'
import { space } from '../../theme/generated/tokens'
import { Banner } from '../ui/Banner'
import { Button as Action } from '../ui/Button'
import { ChangeSummary } from '../ui/ChangeSummary'
import { Pill } from '../ui/Pill'
import { SegmentedControl } from '../ui/SegmentedControl'
import { StickyFooter } from '../ui/StickyFooter'
import {
  Button,
  CheckboxLabel,
  Heading,
  Label,
  Link,
  Panel,
  Paragraph,
  Select,
  Small,
  Summary,
} from '../ui/primitives'
import { PreparationTreeView, STATE_TONE } from './PreparationTreeView'

export const MAX_PREPARED_LOTS = 10

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

  const ready = [...new Set([...(preview?.selected_lot_ids ?? []), ...readyLotIds(workspace)])]
  const ticked = chosen ?? preview?.selected_lot_ids ?? ready.slice(0, MAX_PREPARED_LOTS)
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
    <Layout>
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
              Up to {MAX_PREPARED_LOTS} lots at a time. Changing the lots prepares them again.
            </Small>
            {ready.map((id) => (
              <CheckboxLabel key={id}>
                <input
                  type="checkbox"
                  checked={ticked.includes(id)}
                  disabled={busy || (!ticked.includes(id) && ticked.length >= MAX_PREPARED_LOTS)}
                  onChange={() => toggle(id)}
                />
                {lotLabel(id)}
              </CheckboxLabel>
            ))}
            {untickedAll && <Small role="status">Tick at least one lot to add.</Small>}
            {!matches && ticked.length > 0 && (preview === null || !busy) && (
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
        <Heading id="what-will-change">What will change in InvenTree</Heading>
        {!preview ? (
          <Paragraph>Nothing is prepared yet.</Paragraph>
        ) : (
          <>
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
                      <>
                        <Pill tone={STATE_TONE[node.state]}>{STATE_LABELS[node.state]}</Pill>
                        {node.detail && <Small>{node.detail}</Small>}
                      </>
                    ),
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
        leading={<Pill tone="info">Test InvenTree</Pill>}
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
          <Action variant="primary" size="lg" disabled={!approvable} onClick={approve}>
            Approve {lots} {lots === 1 ? 'lot' : 'lots'} and add to InvenTree
          </Action>
        }
      />
    </Layout>
  )
}

const Layout = styled.div`
  display: grid;
  gap: ${space[3]};
`
const SectionHeading = styled(Heading)`
  margin-top: ${space[3]};
`
const Controls = styled.div`
  display: flex;
  flex-wrap: wrap;
  gap: ${space[2]};
`
const Binding = styled.div`
  display: grid;
  gap: ${space[1]};
  overflow-wrap: anywhere;
`
