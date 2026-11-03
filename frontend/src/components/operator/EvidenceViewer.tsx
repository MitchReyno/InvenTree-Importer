import { useEffect, useState } from 'react'
import styled from 'styled-components'
import type { MediaEvidenceDto, MediaSnapshotDto } from '@invimport/contracts'
import {
  evidenceFromHash,
  withEvidence,
  type EvidenceSelection,
} from '../../operator/evidence-location'
import { mediaResource } from '../../media/types'
import { mediaIdentityLabels } from '../../media/identity-labels'
import { MediaNoteSummary } from '../media/MediaNoteSummary'
import { Button, Label, Select, Small } from '../ui/primitives'

interface Props {
  batchId: string
  lotId?: string
  evidence: MediaEvidenceDto[]
  groups?: MediaSnapshotDto['groups']
  unavailable?: boolean
}

type Selection = EvidenceSelection

function firstPage(evidence: MediaEvidenceDto, versionId?: string): Selection | null {
  const version = versionId
    ? evidence.versions.find((item) => item.id === versionId)
    : evidence.versions.find((item) => item.state === 'ready' && item.pages.length > 0)
  const page = version?.state === 'ready' ? version.pages[0] : undefined
  return version && page
    ? {
        evidenceId: evidence.id,
        versionId: version.id,
        page: page.page,
        previewId: page.preview_id,
      }
    : null
}

/** A selected retained page stays pinned even when polling adds or removes versions. */
export function EvidenceViewer({
  batchId,
  lotId,
  evidence,
  groups = [],
  unavailable = false,
}: Props) {
  const [invalidLink, setInvalidLink] = useState(() =>
    Boolean(lotId && evidenceFromHash(location.hash) === null),
  )
  const [selected, setSelected] = useState<Selection | null>(() => {
    if (lotId) {
      const linked = evidenceFromHash(location.hash)
      if (linked !== undefined) {
        return linked
      }
    }
    for (const item of evidence) {
      const page = firstPage(item)
      if (page) {
        return page
      }
    }
    return null
  })
  const [zoom, setZoom] = useState(1)
  const [failedPreview, setFailedPreview] = useState<string | null>(null)
  const [loadAttempt, setLoadAttempt] = useState(0)
  const labels = mediaIdentityLabels(evidence)
  const source = evidence.find((item) => item.id === selected?.evidenceId)
  const version = source?.versions.find((item) => item.id === selected?.versionId)
  const page = version?.pages.find(
    (item) => item.page === selected?.page && item.preview_id === selected.previewId,
  )
  const available = version?.state === 'ready' && page !== undefined
  const failed = selected !== null && failedPreview === selected.previewId
  const sourceUnavailable = selected !== null && (!source || !version)

  useEffect(() => {
    if (
      lotId &&
      selected &&
      location.hash.split('?')[0] === `#${batchId}/review/${lotId}` &&
      evidenceFromHash(location.hash) === undefined
    ) {
      history.replaceState(null, '', withEvidence(location.hash, selected))
    }
  }, [batchId, lotId, selected])

  useEffect(() => {
    if (!lotId) {
      return
    }

    function acceptInspectionRoute() {
      // The application guard restores a protected draft URL synchronously first.
      queueMicrotask(() => {
        if (location.hash.split('?')[0] !== `#${batchId}/review/${lotId}`) {
          return
        }
        const linked = evidenceFromHash(location.hash)
        let next = linked ?? null
        if (linked === undefined) {
          for (const item of evidence) {
            const page = firstPage(item)
            if (page) {
              next = page
              break
            }
          }
        }
        if (linked === undefined && next) {
          history.replaceState(null, '', withEvidence(location.hash, next))
        }
        setInvalidLink(linked === null)
        if (JSON.stringify(next) !== JSON.stringify(selected)) {
          setSelected(next)
          setZoom(1)
          setFailedPreview(null)
        }
      })
    }

    addEventListener('hashchange', acceptInspectionRoute)
    addEventListener('popstate', acceptInspectionRoute)
    return () => {
      removeEventListener('hashchange', acceptInspectionRoute)
      removeEventListener('popstate', acceptInspectionRoute)
    }
  }, [batchId, lotId, evidence, selected])

  function selectPage(selection: Selection) {
    setSelected(selection)
    setInvalidLink(false)
    setZoom(1)
    setFailedPreview(null)
    if (lotId && location.hash.split('?')[0] === `#${batchId}/review/${lotId}`) {
      history.replaceState(null, '', withEvidence(location.hash, selection))
    }
  }

  function chooseVersion(value: string) {
    if (!value) {
      return
    }
    for (const item of evidence) {
      const selection = firstPage(item, value)
      if (selection) {
        selectPage(selection)
        return
      }
    }
  }

  function choosePage(value: number) {
    const next = version?.pages.find((item) => item.page === value)
    if (source && version && next) {
      selectPage({
        evidenceId: source.id,
        versionId: version.id,
        page: next.page,
        previewId: next.preview_id,
      })
    }
  }

  return (
    <Viewer aria-label="Retained evidence viewer">
      {unavailable && (
        <Small role="status">
          Current media status is unavailable. This is the last retained snapshot.
        </Small>
      )}
      {available && source && version && page ? (
        <>
          <Preview tabIndex={0} aria-label="Evidence image; scroll to inspect when zoomed">
            <PreviewImage
              loading="lazy"
              key={`${page.preview_id}:${loadAttempt}`}
              $zoom={zoom}
              src={mediaResource(batchId, 'previews', page.preview_id)}
              alt={`${source.label} · ${version.kind === 'original' ? 'original' : 'crop'} · page ${page.page}`}
              onError={() => setFailedPreview(page.preview_id)}
            />
          </Preview>
          {failed && (
            <div role="alert">
              <Small>The selected preview could not be loaded.</Small>
              <Button
                type="button"
                onClick={() => {
                  setFailedPreview(null)
                  setLoadAttempt((value) => value + 1)
                }}
              >
                Retry selected preview
              </Button>
            </div>
          )}
          <Small>
            {page.width} × {page.height} source pixels ·{' '}
            {version.kind === 'original' ? 'Retained original' : 'Prepared documentary crop'}. Zoom
            enlarges the retained preview; it does not change the source.
          </Small>
        </>
      ) : (
        <Empty role="status">
          {invalidLink
            ? 'The evidence link is incomplete or invalid. Choose a retained source explicitly; no replacement has been substituted.'
            : selected
              ? 'The selected source, version or page is unavailable. Choose another explicitly; no replacement has been substituted.'
              : 'No preview selected. Choose a ready retained source below, or add evidence in Capture.'}
        </Empty>
      )}
      <Label>
        Evidence source and version
        <Select
          value={version && source ? version.id : ''}
          onChange={(event) => chooseVersion(event.target.value)}
        >
          <option value="" disabled>
            {sourceUnavailable
              ? 'Selected source unavailable — choose explicitly'
              : 'Choose retained evidence'}
          </option>
          {evidence.flatMap((item) =>
            item.versions.map((value) => (
              <option
                key={value.id}
                value={value.id}
                disabled={value.state !== 'ready' || value.pages.length === 0}
              >
                {labels.versions.get(value.id)}
                {value.state !== 'ready' ? ` · ${value.state}` : ''}
              </option>
            )),
          )}
        </Select>
      </Label>
      {version && source && (
        <Controls>
          <Label>
            Document page
            <Select
              value={page?.page ?? ''}
              onChange={(event) => choosePage(Number(event.target.value))}
            >
              {!page && <option value="">Selected page unavailable</option>}
              {version.pages.map((value) => (
                <option key={value.page} value={value.page}>
                  Page {value.page}
                </option>
              ))}
            </Select>
          </Label>
          <Zoom aria-label="Evidence zoom">
            <Button
              type="button"
              disabled={!available || zoom <= 1}
              onClick={() => setZoom((value) => value - 0.5)}
              aria-label="Zoom out"
            >
              −
            </Button>
            <Small aria-live="polite">{Math.round(zoom * 100)}%</Small>
            <Button
              type="button"
              disabled={!available || zoom >= 3}
              onClick={() => setZoom((value) => value + 0.5)}
              aria-label="Zoom in"
            >
              +
            </Button>
            <Button type="button" disabled={!available || zoom === 1} onClick={() => setZoom(1)}>
              Fit
            </Button>
          </Zoom>
        </Controls>
      )}
      {groups
        .filter((group) => evidence.some((item) => item.group_id === group.id))
        .map((group) => (
          <MediaNoteSummary key={group.id} title={`Group ${group.label}`} note={group.note} />
        ))}
      {evidence
        .filter((item) => item.note)
        .map((item) => (
          <MediaNoteSummary
            key={item.id}
            title={`Evidence ${labels.evidence.get(item.id)}`}
            note={item.note}
          />
        ))}
    </Viewer>
  )
}

const Viewer = styled.section`
  display: grid;
  gap: 8px;
  margin-bottom: 12px;
  min-width: 0;
`
const Controls = styled.div`
  display: flex;
  align-items: end;
  flex-wrap: wrap;
  gap: 8px;
  > label {
    flex: 1;
    min-width: 110px;
  }
`
const Zoom = styled.div`
  display: flex;
  align-items: center;
  gap: 6px;
  button {
    padding: 6px 10px;
    min-width: 44px;
  }
`
const Preview = styled.div`
  width: 100%;
  height: clamp(240px, 40vw, 460px);
  overflow: auto;
  background: #e8edf3;
  border: 1px solid #c8d3e1;
  border-radius: 6px;
  @media (max-width: 700px) {
    height: 280px;
  }
`
const PreviewImage = styled.img<{ $zoom: number }>`
  display: block;
  width: ${(p) => p.$zoom * 100}%;
  max-width: none;
  height: auto;
`
const Empty = styled.div`
  padding: 24px 12px;
  background: #f3f5f8;
  color: #526179;
  border-radius: 6px;
  line-height: 1.5;
`
