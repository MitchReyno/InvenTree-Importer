import Moveable from 'react-moveable'
import { useEffect, useRef, useState } from 'react'
import styled from 'styled-components'
import type { CaptureEditDto, CaptureSnapshotDto, MediaSnapshotDto } from '@invimport/contracts'
import { previewImage } from '../../media/images'
import { color, radius, space, type, typeVar } from '../../theme/generated/tokens'
import { Button } from '../ui/Button'
import { Input, Label, Small } from '../ui/primitives'

type Evidence = MediaSnapshotDto['evidence'][number]
type Box = { x: number; y: number; width: number; height: number }
type Draft = Box & { observationId?: string; sourceWidth: number; sourceHeight: number }

type Props = {
  batchId: string
  evidence: Evidence
  label: string
  observations: NonNullable<CaptureSnapshotDto['evidence_observations']>
  disabled: boolean
  save: (change: CaptureEditDto['change']) => Promise<unknown>
}

/** The first page of the file's original version, which its regions are drawn on. */
function stagePage(evidence: Evidence) {
  const version = (evidence.versions ?? []).find((value) => value.kind === 'original')
  const page = version?.pages?.[0]
  return version && page ? { version, page } : null
}

const FIELDS: [keyof Box, string][] = [
  ['x', 'Left'],
  ['y', 'Top'],
  ['width', 'Width'],
  ['height', 'Height'],
]

/**
 * The selected photo with its regions. A region adjusts by dragging it or its corners, or through
 * its numbers; Add a region starts a new one. Saving sends the capture edit `kind: 'observation'`.
 */
export function RegionStage({ batchId, evidence, label, observations, disabled, save }: Props) {
  const found = stagePage(evidence)
  const [draft, setDraft] = useState<Draft | null>(null)
  const [saving, setSaving] = useState(false)
  const [failed, setFailed] = useState(false)
  const surface = useRef<HTMLDivElement>(null)
  const target = useRef<HTMLDivElement>(null)
  const moveable = useRef<Moveable>(null)
  const [surfaceWidth, setSurfaceWidth] = useState(0)

  useEffect(() => {
    const element = surface.current
    if (!element || typeof ResizeObserver !== 'function') {
      return
    }
    const observer = new ResizeObserver(([entry]) => setSurfaceWidth(entry.contentRect.width))
    observer.observe(element)
    return () => observer.disconnect()
  }, [])

  useEffect(() => {
    moveable.current?.updateRect()
  }, [draft, surfaceWidth])

  if (!found) {
    return null
  }
  const { version, page } = found
  const regions = observations.filter(
    (item) =>
      item.status === 'active' &&
      item.evidence_version_id === version.id &&
      item.region.kind === 'pixels',
  )

  const nameOf = (item: (typeof regions)[number], index: number) =>
    item.readings?.markings?.find(Boolean) || item.readings?.text || `Region ${index + 1}`

  const scale = (sourceWidth: number) => (surfaceWidth ? surfaceWidth / sourceWidth : 0)

  async function submit() {
    if (!draft) {
      return
    }
    setSaving(true)
    try {
      await save({
        kind: 'observation',
        ...(draft.observationId ? { observation_id: draft.observationId } : {}),
        evidence_version_id: version.id,
        page: page.page,
        region: {
          kind: 'pixels',
          x: draft.x,
          y: draft.y,
          width: draft.width,
          height: draft.height,
          source_width: draft.sourceWidth,
          source_height: draft.sourceHeight,
        },
      })
      setDraft(null)
    } finally {
      setSaving(false)
    }
  }

  const locked = disabled || saving
  const draftScale = draft ? scale(draft.sourceWidth) : 0

  return (
    <Stage aria-label={`Regions of ${label}`}>
      <StageTitle>Regions of {label}</StageTitle>
      <Surface ref={surface} $ratio={page.width / page.height}>
        {failed ? (
          <Missing>
            <span aria-hidden="true">▧</span>
            {label}
          </Missing>
        ) : (
          <img
            {...previewImage(batchId, page, 'viewer')}
            alt={`${label}, page ${page.page}`}
            draggable={false}
            onError={() => setFailed(true)}
          />
        )}
        {regions.map((item, index) => {
          if (item.region.kind !== 'pixels' || item.id === draft?.observationId) {
            return null
          }
          const s = scale(item.region.source_width)
          return (
            <Outline
              key={item.id}
              aria-hidden="true"
              style={{
                left: item.region.x * s,
                top: item.region.y * s,
                width: item.region.width * s,
                height: item.region.height * s,
              }}
            >
              <span>{index + 1}</span>
            </Outline>
          )
        })}
        {draft && (
          <Editing
            ref={target}
            aria-hidden="true"
            style={{
              left: draft.x * draftScale,
              top: draft.y * draftScale,
              width: draft.width * draftScale,
              height: draft.height * draftScale,
            }}
          />
        )}
        {draft && draftScale > 0 && !locked && (
          <Moveable
            ref={moveable}
            target={target}
            draggable
            resizable
            origin={false}
            renderDirections={['nw', 'ne', 'sw', 'se']}
            throttleDrag={0}
            throttleResize={0}
            onDrag={(event) =>
              setDraft({
                ...draft,
                x: Math.round(event.left / draftScale),
                y: Math.round(event.top / draftScale),
              })
            }
            onResize={(event) =>
              setDraft({
                ...draft,
                x: Math.round((draft.x * draftScale + event.drag.beforeTranslate[0]) / draftScale),
                y: Math.round((draft.y * draftScale + event.drag.beforeTranslate[1]) / draftScale),
                width: Math.max(1, Math.round(event.width / draftScale)),
                height: Math.max(1, Math.round(event.height / draftScale)),
              })
            }
          />
        )}
      </Surface>
      <Choices>
        {regions.map((item, index) =>
          item.region.kind === 'pixels' ? (
            <Button
              key={item.id}
              size="sm"
              disabled={locked}
              aria-pressed={draft?.observationId === item.id}
              aria-label={`Adjust ${nameOf(item, index)}`}
              onClick={() =>
                item.region.kind === 'pixels' &&
                setDraft({
                  observationId: item.id,
                  x: item.region.x,
                  y: item.region.y,
                  width: item.region.width,
                  height: item.region.height,
                  sourceWidth: item.region.source_width,
                  sourceHeight: item.region.source_height,
                })
              }
            >
              {index + 1} · {nameOf(item, index)}
            </Button>
          ) : null,
        )}
        <Button
          size="sm"
          variant="ghost"
          disabled={locked}
          onClick={() =>
            setDraft({
              x: Math.round(page.width / 4),
              y: Math.round(page.height / 4),
              width: Math.round(page.width / 2),
              height: Math.round(page.height / 2),
              sourceWidth: page.width,
              sourceHeight: page.height,
            })
          }
        >
          Add a region
        </Button>
      </Choices>
      {draft && (
        <Fields>
          {FIELDS.map(([key, name]) => (
            <Label key={key}>
              {name}
              <Input
                type="number"
                min={key === 'width' || key === 'height' ? 1 : 0}
                value={draft[key]}
                disabled={locked}
                onChange={(event) =>
                  setDraft({ ...draft, [key]: Math.max(0, Number(event.target.value) || 0) })
                }
              />
            </Label>
          ))}
          <Small>Pixels of the original photo. Drag the box or its corners to adjust it.</Small>
          <span>
            <Button size="sm" variant="primary" disabled={locked} onClick={() => void submit()}>
              Save region
            </Button>{' '}
            <Button size="sm" variant="ghost" disabled={saving} onClick={() => setDraft(null)}>
              Discard
            </Button>
          </span>
        </Fields>
      )}
    </Stage>
  )
}

const Stage = styled.section`
  display: grid;
  gap: ${space[4]};
  padding: ${space[7]} ${space[8]};
  border: 1px solid ${color.line};
  border-radius: ${radius.card};
  background: ${color.surface};
`
const StageTitle = styled.h3`
  margin: 0;
  ${type.label}
  color: ${color.muted};
`
/** Capped so a tall photo does not push its controls off the screen. */
const Surface = styled.div<{ $ratio: number }>`
  position: relative;
  width: 100%;
  /* literal-allowed: the stage's reading width; no layout width token */
  max-width: 720px;
  aspect-ratio: ${(p) => p.$ratio};
  overflow: hidden;
  border-radius: ${radius.btn};
  background: ${color.photoStage};
  img {
    display: block;
    width: 100%;
    height: 100%;
    object-fit: contain;
    user-select: none;
  }
`
const Missing = styled.div`
  display: grid;
  place-content: center;
  justify-items: center;
  gap: ${space[3]};
  height: 100%;
  color: ${color.photoFg};
  font-size: ${typeVar.small.size};
`
const Outline = styled.div`
  position: absolute;
  border: 2px solid ${color.photoFg};
  box-shadow: 0 0 0 1px ${color.photoStage};
  span {
    position: absolute;
    top: 0;
    left: 0;
    padding: 0 ${space[2]};
    background: ${color.photoFg};
    color: ${color.photoStage};
    font-size: ${typeVar.small.size};
  }
`
const Editing = styled.div`
  position: absolute;
  border: 2px solid ${color.accent};
  background: ${color.accentWeak};
  opacity: 0.6;
`
const Choices = styled.div`
  display: flex;
  flex-wrap: wrap;
  gap: ${space[3]};
`
const Fields = styled.div`
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(90px, 1fr));
  gap: ${space[3]} ${space[4]};
  align-items: end;
  > small,
  > span {
    grid-column: 1 / -1;
  }
`
