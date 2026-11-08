import { useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import styled from 'styled-components'
import { VisuallyHidden } from '../ui/VisuallyHidden'
import type { CaptureEditDto, CaptureSnapshotDto, MediaSnapshotDto } from '@invimport/contracts'
import { RegionStage } from './RegionStage'
import { reviewMap, type MapEdge } from '../../operator/review-map'
import { color, radius, size, space, type, typeVar, zIndex } from '../../theme/generated/tokens'
import { media } from '../ui/media'
import { Select } from '../ui/primitives'
import { Banner } from '../ui/Banner'
import { Button } from '../ui/Button'
import { Pill } from '../ui/Pill'

type Props = {
  batch: CaptureSnapshotDto
  /** Undefined while the media read is unavailable. */
  evidence: MediaSnapshotDto['evidence'] | undefined
  retiredLotIds: ReadonlySet<string>
  /** Each lot's direct predecessors, whose evidence its successors inherit. */
  predecessors?: ReadonlyMap<string, readonly string[]>
  disabled: boolean
  link: (evidenceId: string, lotId: string, linked: boolean) => Promise<void>
  newLotFrom: (evidenceId: string, label: string) => Promise<void>
  /** Moves a region's observation to another lot, or out of any (`observation_move`). */
  moveRegion?: (observationId: string, lotId: string | null) => Promise<void>
  newLotFromRegion?: (observationId: string, label: string) => Promise<void>
  /** Adjusts or adds a region on the selected photo (the capture edit `kind: 'observation'`). */
  editRegion?: (change: CaptureEditDto['change']) => Promise<unknown>
  onRegionDirtyChange?: (dirty: boolean) => void
  /** An unsaved region draft holds the selected photo until it is saved or discarded. */
  selectionLocked?: boolean
  /** Opens the existing split or merge command; absent where restructuring is unavailable. */
  openRestructure?: (kind: 'split' | 'merge' | 'move', lotIds: string[]) => void
  /** Lots already added to inventory, which cannot be restructured. */
  approvedLotIds: ReadonlySet<string>
  /** Locks split, merge and move until the latest operator review is read. */
  restructureUnavailable?: boolean
  loading: boolean
  /** Drawn at the foot of the Lots column, e.g. the Tell Examine composer. */
  aside?: ReactNode
}

const MAX_MERGE_LOTS = 10
/* literal-allowed: the canvas's connector gutter */
const CONNECTOR_GUTTER = '140px'

/** How the evidence became lots, with the direct edits that change it. */
export function ReviewMap({
  batch,
  evidence,
  retiredLotIds,
  predecessors,
  disabled,
  link,
  newLotFrom,
  moveRegion,
  newLotFromRegion,
  editRegion,
  onRegionDirtyChange,
  selectionLocked = false,
  openRestructure,
  approvedLotIds,
  restructureUnavailable = false,
  loading,
  aside,
}: Props) {
  const [targets, setTargets] = useState<Record<string, string>>({})
  const [merging, setMerging] = useState<string[]>([])
  const [selectedFile, setSelectedFile] = useState<string | null>(null)
  const canvas = useRef<HTMLDivElement>(null)
  const paths = useConnectorPaths(canvas, [batch, evidence, retiredLotIds, predecessors])

  if (loading) {
    return (
      <MapShell
        canvas={canvas}
        aside={aside}
        notice={<Muted role="status">Reading evidence…</Muted>}
      />
    )
  }
  if (!evidence) {
    return (
      <MapShell
        canvas={canvas}
        aside={aside}
        notice={
          <Banner tone="bad">
            Evidence is unavailable, so the map cannot be drawn. Each lot&apos;s evidence is still
            in Lots.
          </Banner>
        }
      />
    )
  }

  const map = reviewMap(batch, evidence, retiredLotIds, predecessors)
  const fileLabel = new Map(map.files.map((file) => [file.id, file.label]))
  const lotLabel = new Map(map.lots.map((lot) => [lot.id, lot.label]))
  // A merge or split retires lots; only active, unadded lots stay chosen.
  const chosen = merging.filter((id) => lotLabel.has(id) && !approvedLotIds.has(id))
  const restructureLocked = disabled || restructureUnavailable

  // Lots a file can still be linked to directly; a choice that has since left the list is no choice.
  const linkOptions = (file: (typeof map.files)[number]) =>
    map.lots.filter(
      (lot) => !file.links.some((item) => item.lotId === lot.id && item.via === 'direct'),
    )

  const targetFor = (file: (typeof map.files)[number]) => {
    const chosenLot = targets[file.id]
    return chosenLot && linkOptions(file).some((lot) => lot.id === chosenLot) ? chosenLot : ''
  }

  // Until the latest review is read, a retired lot's files may already be inherited by its successors.
  const lineagePending = restructureUnavailable && retiredLotIds.size > 0
  const fromRetired = new Set(
    evidence
      .filter((file) => file.linked_subject_ids.some((id) => retiredLotIds.has(id)))
      .map((file) => file.id),
  )

  const unusedCount = map.files.filter((file) => file.unused).length
  const singleObservation = map.lots.filter(
    (lot) => lot.singleSource && lot.observations > 0,
  ).length
  const singleFile = map.lots.filter((lot) => lot.singleSource && lot.observations === 0).length
  const edges = map.files.flatMap((file) =>
    file.edges.map((edge) => ({ ...edge, fileId: file.id })),
  )

  return (
    <MapShell
      canvas={canvas}
      aside={aside}
      ready
      title={
        <>
          <TitleRow>
            <DiagramTitle>How photos became lots</DiagramTitle>
            {unusedCount > 0 && (
              <Pill status="warning">
                {unusedCount} {unusedCount === 1 ? 'file' : 'files'} in no lot
              </Pill>
            )}
            {singleObservation > 0 && (
              <Pill status="warning">
                {singleObservation} {singleObservation === 1 ? 'lot' : 'lots'} on a single
                observation
              </Pill>
            )}
            {singleFile > 0 && (
              <Pill status="warning">
                {singleFile} {singleFile === 1 ? 'lot' : 'lots'} on a single file
              </Pill>
            )}
          </TitleRow>
          {editRegion && selectedFile && evidence.find((file) => file.id === selectedFile) && (
            <RegionStage
              key={selectedFile}
              batchId={batch.id}
              evidence={evidence.find((file) => file.id === selectedFile)!}
              label={fileLabel.get(selectedFile) ?? 'Selected file'}
              observations={batch.evidence_observations ?? []}
              disabled={disabled}
              save={editRegion}
              onDirtyChange={onRegionDirtyChange}
            />
          )}
        </>
      }
      evidence={
        <Column aria-labelledby="map-evidence">
          <Title id="map-evidence">Evidence</Title>
          <Rows>
            {map.files.map((file, index) => (
              <li
                key={file.id}
                aria-label={file.label}
                data-selected={selectedFile === file.id || undefined}
                data-unused={file.unused || undefined}
              >
                <Head data-file-anchor={file.id}>
                  <FileToggle
                    type="button"
                    aria-pressed={selectedFile === file.id}
                    disabled={selectionLocked}
                    aria-label={`Show links for ${file.label}`}
                    onClick={() => setSelectedFile(selectedFile === file.id ? null : file.id)}
                  >
                    <Number>{index + 1}</Number>
                    <strong>{file.label}</strong>
                  </FileToggle>
                  {file.unused && (
                    <Pill tone="warn">
                      {lineagePending && fromRetired.has(file.id)
                        ? 'No lot yet · checking history'
                        : 'Used by no lot'}
                    </Pill>
                  )}
                </Head>
                {file.links.length > 0 && (
                  <Links>
                    Supports:
                    {file.links.map(({ lotId, via }) => (
                      <Chip key={lotId}>
                        {lotLabel.get(lotId)}
                        {via !== 'direct' ? (
                          <Muted>{via === 'part' ? ' via shared Part' : ' via earlier lot'}</Muted>
                        ) : (
                          <button
                            type="button"
                            disabled={disabled}
                            aria-label={`Unlink ${lotLabel.get(lotId)} from ${file.label}`}
                            onClick={() => void link(file.id, lotId, false)}
                          >
                            ×
                          </button>
                        )}
                      </Chip>
                    ))}
                  </Links>
                )}
                {file.regions.length > 0 && (
                  <Regions aria-label={`Regions of ${file.label}`}>
                    {file.regions.map((region) => (
                      <li key={region.id}>
                        <span>
                          {region.label} <span aria-hidden="true">→</span>
                          {region.lotId && <VisuallyHidden> supports</VisuallyHidden>}{' '}
                          {region.lotId ? lotLabel.get(region.lotId) : <Muted>no lot</Muted>}
                        </span>
                        {moveRegion && (
                          <RegionMove
                            region={region}
                            lots={map.lots}
                            disabled={disabled}
                            move={moveRegion}
                            newLot={newLotFromRegion}
                          />
                        )}
                      </li>
                    ))}
                  </Regions>
                )}
                <Controls>
                  <LinkSelect
                    aria-label={`Link ${file.label} to a lot`}
                    value={targetFor(file)}
                    disabled={disabled}
                    onChange={(event) => setTargets({ ...targets, [file.id]: event.target.value })}
                  >
                    <option value="">Link to a lot…</option>
                    {linkOptions(file).map((lot) => (
                      <option key={lot.id} value={lot.id}>
                        {lot.label}
                      </option>
                    ))}
                  </LinkSelect>
                  <Button
                    size="sm"
                    disabled={disabled || !targetFor(file)}
                    onClick={() => void link(file.id, targetFor(file), true)}
                  >
                    Link
                  </Button>
                  {file.unused && (
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={disabled || (lineagePending && fromRetired.has(file.id))}
                      aria-label={`New lot from this: ${file.label}`}
                      onClick={() => void newLotFrom(file.id, file.label)}
                    >
                      New lot from this
                    </Button>
                  )}
                </Controls>
              </li>
            ))}
          </Rows>
        </Column>
      }
      lots={
        <>
          <Rows>
            {map.lots.map((lot) => (
              <li
                key={lot.id}
                aria-label={lot.label}
                data-selected={
                  (selectedFile !== null &&
                    map.files.find((file) => file.id === selectedFile)?.lotIds.includes(lot.id)) ||
                  undefined
                }
              >
                <Head data-lot-anchor={lot.id}>
                  {openRestructure && (
                    <CheckHit>
                      <input
                        type="checkbox"
                        aria-label={`Choose ${lot.label} to merge or move`}
                        checked={chosen.includes(lot.id)}
                        disabled={restructureLocked || approvedLotIds.has(lot.id)}
                        onChange={() =>
                          setMerging(
                            merging.includes(lot.id)
                              ? merging.filter((id) => id !== lot.id)
                              : [...merging, lot.id],
                          )
                        }
                      />
                    </CheckHit>
                  )}
                  <strong>{lot.label}</strong>
                  {lot.observations > 0 && <Muted>· {lot.observations} obs.</Muted>}
                  {lot.singleSource &&
                    (lot.observations > 0 ? (
                      <Pill status="warning">1 obs.</Pill>
                    ) : (
                      <Pill status="warning">Rests on one file</Pill>
                    ))}
                  {lot.fileIds.length === 0 && (
                    <Pill tone="warn">
                      {lineagePending ? 'No evidence yet · checking history' : 'No evidence'}
                    </Pill>
                  )}
                </Head>
                {lot.fileIds.length > 0 && (
                  <Muted>From: {lot.fileIds.map((id) => fileLabel.get(id)).join(', ')}</Muted>
                )}
                {openRestructure && (
                  <Controls>
                    <Button
                      size="sm"
                      disabled={restructureLocked || approvedLotIds.has(lot.id)}
                      aria-label={`Split ${lot.label}`}
                      onClick={() => openRestructure('split', [lot.id])}
                    >
                      Split
                    </Button>
                  </Controls>
                )}
              </li>
            ))}
          </Rows>
          {openRestructure && restructureUnavailable && (
            <Muted role="status">
              Split, merge and move, and evidence inherited through them, wait for the latest review
              to load.
            </Muted>
          )}
          {openRestructure && (
            <Fix role="group" aria-labelledby="map-fix">
              <FixTitle id="map-fix">Fix lots directly</FixTitle>
              <Button
                size="sm"
                disabled={restructureLocked || chosen.length < 2 || chosen.length > MAX_MERGE_LOTS}
                onClick={() => openRestructure('merge', chosen)}
              >
                Merge {chosen.length} lots
              </Button>
              <Button
                size="sm"
                disabled={restructureLocked || chosen.length < 1 || chosen.length > MAX_MERGE_LOTS}
                onClick={() => openRestructure('move', chosen)}
              >
                Move {chosen.length} {chosen.length === 1 ? 'lot' : 'lots'} to a Part proposal
              </Button>
            </Fix>
          )}
        </>
      }
      drawing={
        <Drawing aria-hidden="true">
          {edges.map((edge) => (
            <Connector
              key={`${edge.fileId}:${edge.lotId}`}
              edge={edge}
              d={paths[`${edge.fileId}:${edge.lotId}`]}
              selected={edge.fileId === selectedFile}
            />
          ))}
        </Drawing>
      }
      caption={
        <Muted>
          Solid: the file shows the lot. Dotted: a document line, the lot&apos;s shared Part or an
          earlier lot supports it. Choose a file to highlight its links.
        </Muted>
      }
    />
  )
}

/** Moves one region to another lot, or makes a new lot from it. */
function RegionMove({
  region,
  lots,
  disabled,
  move,
  newLot,
}: {
  region: { id: string; label: string; lotId: string | null }
  lots: { id: string; label: string }[]
  disabled: boolean
  move: (observationId: string, lotId: string | null) => Promise<void>
  newLot?: (observationId: string, label: string) => Promise<void>
}) {
  const [target, setTarget] = useState('')
  const targets = lots.filter((lot) => lot.id !== region.lotId)
  return (
    <Controls>
      <LinkSelect
        aria-label={`Move ${region.label} to`}
        value={target}
        disabled={disabled}
        onChange={(event) => setTarget(event.target.value)}
      >
        <option value="">Move to a lot…</option>
        {targets.map((lot) => (
          <option key={lot.id} value={lot.id}>
            {lot.label}
          </option>
        ))}
        {region.lotId !== null && <option value="none">No lot</option>}
      </LinkSelect>
      <Button
        size="sm"
        disabled={disabled || !target}
        aria-label={`Move ${region.label}`}
        onClick={() => void move(region.id, target === 'none' ? null : target)}
      >
        Move
      </Button>
      {newLot && (
        <Button
          size="sm"
          variant="ghost"
          disabled={disabled}
          aria-label={`New lot from region: ${region.label}`}
          onClick={() => void newLot(region.id, region.label)}
        >
          New lot from this
        </Button>
      )}
    </Controls>
  )
}

/**
 * The Map's frame in every state. Tell Examine (`aside`) keeps one place at the foot of the Lots
 * column, so loading finishing never remounts it mid-send.
 */
function MapShell({
  canvas,
  aside,
  ready = false,
  notice,
  title,
  evidence,
  lots,
  drawing,
  caption,
}: {
  canvas: React.RefObject<HTMLDivElement | null>
  aside: ReactNode
  ready?: boolean
  notice?: ReactNode
  title?: ReactNode
  evidence?: ReactNode
  lots?: ReactNode
  drawing?: ReactNode
  caption?: ReactNode
}) {
  return (
    <Diagram>
      {notice}
      {title}
      <Scroller>
        <Layout ref={canvas} data-ready={ready || undefined}>
          {evidence}
          <Column aria-labelledby="map-lots">
            <Title id="map-lots">Lots</Title>
            {lots}
            {aside}
          </Column>
          {drawing}
        </Layout>
      </Scroller>
      {caption}
    </Diagram>
  )
}

/** One decorative curve from a file card to a lot card; the cards say the same in words. */
function Connector({
  edge,
  d,
  selected,
}: {
  edge: MapEdge
  d: string | undefined
  selected: boolean
}) {
  return (
    <path
      d={d ?? 'M0 0'}
      data-style={edge.style}
      data-selected={selected || undefined}
      fill="none"
      style={{
        stroke: selected ? color.accent : color.lineStrong,
        strokeWidth: selected ? 2 : 1.5,
        strokeDasharray: edge.style === 'dotted' ? '2 4' : undefined,
      }}
    />
  )
}

/** Measures each card's heading after layout and on resize, and curves between the two. */
function useConnectorPaths(
  canvas: React.RefObject<HTMLDivElement | null>,
  inputs: readonly unknown[],
) {
  const [paths, setPaths] = useState<Record<string, string>>({})
  useLayoutEffect(() => {
    const root = canvas.current
    if (!root) {
      return
    }

    const measure = () => {
      const origin = root.getBoundingClientRect()
      const next: Record<string, string> = {}
      root.querySelectorAll<HTMLElement>('[data-file-anchor]').forEach((fileHead) => {
        const from = fileHead.getBoundingClientRect()
        const fileId = fileHead.dataset.fileAnchor!
        root.querySelectorAll<HTMLElement>('[data-lot-anchor]').forEach((lotHead) => {
          const to = lotHead.getBoundingClientRect()
          const x1 = from.right - origin.left
          const y1 = from.top + from.height / 2 - origin.top
          const x2 = to.left - origin.left
          const y2 = to.top + to.height / 2 - origin.top
          const bend = Math.max((x2 - x1) / 2, 0)
          next[`${fileId}:${lotHead.dataset.lotAnchor}`] =
            `M${x1} ${y1} C${x1 + bend} ${y1}, ${x2 - bend} ${y2}, ${x2} ${y2}`
        })
      })
      setPaths(next)
    }

    measure()
    const observer = typeof ResizeObserver === 'function' ? new ResizeObserver(measure) : null
    observer?.observe(root)
    return () => observer?.disconnect()
  }, inputs)
  return paths
}

const Diagram = styled.div`
  display: grid;
  gap: ${space[4]};
`

const TitleRow = styled.div`
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: ${space[3]} ${space[4]};
`

const DiagramTitle = styled.h2`
  margin: 0;
  ${type.h2}
`

/** At phone width the diagram keeps its three columns and scrolls sideways. */
const Scroller = styled.div`
  overflow-x: auto;
`

/** Evidence, a gutter the connectors cross, and lots. */
const Layout = styled.div`
  position: relative;
  display: grid;
  align-items: start;
  &[data-ready] {
    grid-template-columns: minmax(260px, 1fr) ${CONNECTOR_GUTTER} minmax(260px, 1fr);
    /* literal-allowed: two 260px columns and the connector gutter */
    min-width: 660px;
  }
  &[data-ready] > section:last-of-type {
    grid-column: 3;
  }
`

const Drawing = styled.svg`
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  overflow: visible;
  pointer-events: none;
`

const FileToggle = styled.button`
  display: inline-flex;
  align-items: center;
  gap: ${space[4]};
  padding: 0;
  border: 0;
  background: none;
  color: inherit;
  font: inherit;
  text-align: left;
  cursor: pointer;
  &:hover strong {
    text-decoration: underline;
  }
  ${media.compact} {
    min-height: ${size.touch};
  }
`

const Column = styled.section`
  display: grid;
  gap: ${space[4]};
  min-width: 0;
  padding: ${space[7]} ${space[8]};
  border: 1px solid ${color.line};
  border-radius: ${radius.card};
  background: ${color.surface};
`

const Title = styled.h2`
  margin: 0;
  ${type.label}
  color: ${color.muted};
`

const Rows = styled.ul`
  display: grid;
  margin: 0;
  padding: 0;
  list-style: none;
  gap: ${space[4]};
  > li {
    display: grid;
    gap: ${space[3]};
    padding: ${space[5]} ${space[6]};
    border: 1px solid ${color.line};
    border-radius: ${radius.btn};
    background: ${color.surface};
    position: relative;
    z-index: ${zIndex.raised};
  }
  > li[data-unused] {
    border-style: dashed;
    border-color: ${color.warn};
  }
  > li[data-selected] {
    border-color: ${color.accent};
    background: ${color.accentWeak};
    /* Clears the unlink button's 44px hit area off the controls below it. */
    ${media.compact} {
      gap: ${space[5]};
    }
  }
`

/** The file's place in the list, so a region or lot can name it by number. */
const Number = styled.span`
  display: inline-grid;
  place-items: center;
  min-width: ${space[10]};
  height: ${space[10]};
  padding: 0 ${space[2]};
  border-radius: ${radius.pill};
  background: ${color.fg};
  color: ${color.bg};
  font-size: ${typeVar.small.size};
  font-weight: ${typeVar.bodyStrong.weight};
`

/** A checkbox's clickable area, 44px square below 760px. */
const CheckHit = styled.label`
  display: inline-flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  ${media.compact} {
    min-width: ${size.touch};
    min-height: ${size.touch};
    margin: calc((${space[10]} - ${size.touch}) / 2) 0;
  }
`

/** Sized with the small Link button beside it. */
const LinkSelect = styled(Select)`
  flex: 1 1 160px;
  width: auto;
  min-width: 0;
  padding: ${space[2]} ${space[4]};
  font-size: ${typeVar.small.size};
`

const Fix = styled.div`
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: ${space[3]};
`

const FixTitle = styled.span`
  flex-basis: 100%;
  ${type.label}
  color: ${color.muted};
`

const Head = styled.div`
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: ${space[4]};
`

const Links = styled.div`
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: ${space[3]};
  font-size: ${typeVar.small.size};
  color: ${color.muted};
`

const Chip = styled.span`
  display: inline-flex;
  align-items: center;
  gap: ${space[2]};
  padding: 1px ${space[4]};
  border-radius: ${radius.pill};
  background: ${color.surface2};
  color: ${color.fg};
  button {
    display: inline-grid;
    place-items: center;
    min-width: ${space[12]};
    min-height: ${space[12]};
    border: 0;
    border-radius: ${radius.pill};
    background: none;
    color: ${color.muted};
    cursor: pointer;
  }
  button:hover {
    background: ${color.line};
    color: ${color.fg};
  }
  /* A 44px hit area around the 24px glyph, without growing the chip. */
  ${media.compact} {
    button {
      position: relative;
    }
    button::after {
      content: '';
      position: absolute;
      inset: calc((${space[12]} - ${size.touch}) / 2);
    }
  }
`

const Controls = styled.div`
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: ${space[4]};
`

const Regions = styled.ul`
  display: grid;
  gap: ${space[3]};
  margin: 0;
  padding-left: ${space[8]};
`
const Muted = styled.span`
  font-size: ${typeVar.small.size};
  color: ${color.muted};
`
