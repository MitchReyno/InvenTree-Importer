import { useState } from 'react'
import styled from 'styled-components'
import type { CaptureSnapshotDto, MediaSnapshotDto } from '@invimport/contracts'
import { reviewMap } from '../../operator/review-map'
import { color, radius, space, type } from '../../theme/generated/tokens'
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
  /** Opens the existing split or merge command; absent where restructuring is unavailable. */
  openRestructure?: (kind: 'split' | 'merge' | 'move', lotIds: string[]) => void
  /** Lots already added to inventory, which cannot be restructured. */
  approvedLotIds: ReadonlySet<string>
  /** Locks split, merge and move until the latest operator review is read. */
  restructureUnavailable?: boolean
  loading: boolean
}

const MAX_MERGE_LOTS = 10

/** How the evidence became lots, with the direct edits that change it. */
export function ReviewMap({
  batch,
  evidence,
  retiredLotIds,
  predecessors,
  disabled,
  link,
  newLotFrom,
  openRestructure,
  approvedLotIds,
  restructureUnavailable = false,
  loading,
}: Props) {
  const [targets, setTargets] = useState<Record<string, string>>({})
  const [merging, setMerging] = useState<string[]>([])

  if (loading) {
    return <Muted role="status">Reading evidence…</Muted>
  }
  if (!evidence) {
    return (
      <Banner tone="bad">
        Evidence is unavailable, so the map cannot be drawn. Each lot&apos;s evidence is still in
        Lots.
      </Banner>
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

  return (
    <Layout>
      <Column aria-labelledby="map-evidence">
        <Title id="map-evidence">Evidence</Title>
        <Rows>
          {map.files.map((file) => (
            <li key={file.id} aria-label={file.label}>
              <Head>
                <strong>{file.label}</strong>
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
                      {region.label} →{' '}
                      {region.lotId ? lotLabel.get(region.lotId) : <Muted>no lot</Muted>}
                    </li>
                  ))}
                </Regions>
              )}
              <Controls>
                <select
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
                </select>
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

      <Column aria-labelledby="map-lots">
        <Title id="map-lots">Lots</Title>
        <Rows>
          {map.lots.map((lot) => (
            <li key={lot.id} aria-label={lot.label}>
              <Head>
                {openRestructure && (
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
                )}
                <strong>{lot.label}</strong>
                {lot.singleSource && <Pill tone="info">Rests on one file</Pill>}
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
                    variant="ghost"
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
          <Controls>
            <Button
              disabled={restructureLocked || chosen.length < 2 || chosen.length > MAX_MERGE_LOTS}
              onClick={() => openRestructure('merge', chosen)}
            >
              Merge {chosen.length} lots
            </Button>
            <Button
              variant="ghost"
              disabled={restructureLocked || chosen.length < 1 || chosen.length > MAX_MERGE_LOTS}
              onClick={() => openRestructure('move', chosen)}
            >
              Move {chosen.length} {chosen.length === 1 ? 'lot' : 'lots'} to a Part proposal
            </Button>
          </Controls>
        )}
      </Column>
    </Layout>
  )
}

const Layout = styled.div`
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(320px, 1fr));
  gap: ${space[3]};
  align-items: start;
`

const Column = styled.section`
  display: grid;
  gap: ${space[2]};
  min-width: 0;
  padding: ${space['3-5']} ${space[4]};
  border: 1px solid ${color.line};
  border-radius: ${radius.card};
  background: ${color.surface};
`

const Title = styled.h2`
  margin: 0;
  ${type.h2}
`

const Rows = styled.ul`
  display: grid;
  margin: 0;
  padding: 0;
  list-style: none;
  li {
    display: grid;
    gap: ${space[1]};
    padding: ${space['2-5']} 0;
    border-top: 1px solid ${color.line};
  }
  li:first-child {
    border-top: 0;
  }
`

const Head = styled.div`
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: ${space[2]};
`

const Links = styled.div`
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: ${space['1-5']};
  font-size: 12.5px;
  color: ${color.muted};
`

const Chip = styled.span`
  display: inline-flex;
  align-items: center;
  gap: ${space[1]};
  padding: 1px ${space[2]};
  border-radius: ${radius.pill};
  background: ${color.surface2};
  color: ${color.fg};
  button {
    border: 0;
    background: none;
    color: ${color.muted};
    cursor: pointer;
  }
`

const Controls = styled.div`
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: ${space[2]};
`

const Regions = styled.ul`
  display: grid;
  gap: 2px;
  margin: 0;
  padding-left: ${space[4]};
`
const Muted = styled.span`
  font-size: 12.5px;
  color: ${color.muted};
`
