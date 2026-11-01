import { useEffect, useRef, useState, type PointerEvent } from 'react'
import styled from 'styled-components'
import type { MediaRecipeDto, MediaVersionDto } from '@invimport/contracts'
import { Button, Heading, Paragraph, Small } from '../ui/primitives'
import { mediaResource } from '../../media/types'

interface Props {
  batchId: string
  version: MediaVersionDto
  pageNumber: number
  save: (recipe: MediaRecipeDto) => Promise<void>
  close: () => void
  onDirtyChange: (dirty: boolean) => void
}

export function MediaCropDialog({
  batchId,
  version,
  pageNumber,
  save,
  close,
  onDirtyChange,
}: Props) {
  const page = version.pages.find((item) => item.page === pageNumber)!
  const dialog = useRef<HTMLDialogElement>(null)
  const [crop, setCrop] = useState({ x: 0, y: 0, width: page.width, height: page.height })
  const [turns, setTurns] = useState(0)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const drag = useRef<{ x: number; y: number } | null>(null)

  useEffect(() => {
    dialog.current?.showModal()
    onDirtyChange(true)
    return () => onDirtyChange(false)
  }, [onDirtyChange])

  const valid =
    Object.values(crop).every(Number.isInteger) &&
    crop.x >= 0 &&
    crop.y >= 0 &&
    crop.width > 0 &&
    crop.height > 0 &&
    crop.x + crop.width <= page.width &&
    crop.y + crop.height <= page.height

  function sourcePoint(event: PointerEvent<HTMLDivElement>) {
    const rectangle = event.currentTarget.getBoundingClientRect()
    return {
      x: Math.min(
        page.width - 1,
        Math.max(0, Math.floor(((event.clientX - rectangle.left) * page.width) / rectangle.width)),
      ),
      y: Math.min(
        page.height - 1,
        Math.max(0, Math.floor(((event.clientY - rectangle.top) * page.height) / rectangle.height)),
      ),
    }
  }

  function dragSelection(event: PointerEvent<HTMLDivElement>) {
    const start = drag.current
    if (!start || busy) {
      return
    }
    const end = sourcePoint(event)
    setCrop({
      x: Math.min(start.x, end.x),
      y: Math.min(start.y, end.y),
      width: Math.abs(end.x - start.x) + 1,
      height: Math.abs(end.y - start.y) + 1,
    })
  }

  async function retainCrop() {
    if (!valid) {
      return
    }
    setBusy(true)
    setError('')
    try {
      await save({
        version: 'documentary-crop/1',
        source_version_id: version.id,
        source_digest: version.digest,
        page: pageNumber,
        source_width: page.width,
        source_height: page.height,
        ...crop,
        quarter_turns: turns,
      })
      close()
    } catch {
      setError(
        'Crop request was not confirmed. The coordinates are preserved; inspect saved evidence before submitting again.',
      )
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog ref={dialog} aria-labelledby="crop-title" onCancel={(event) => event.preventDefault()}>
      <Heading id="crop-title">Prepare documentary crop</Heading>
      <Paragraph>
        Drag a rectangle or enter exact source pixels. The original stays unchanged.
      </Paragraph>
      <Canvas
        $ratio={page.width / page.height}
        onPointerDown={(event) => {
          if (busy) {
            return
          }
          event.currentTarget.setPointerCapture(event.pointerId)
          drag.current = sourcePoint(event)
        }}
        onPointerMove={dragSelection}
        onPointerUp={(event) => {
          dragSelection(event)
          drag.current = null
        }}
        onPointerCancel={() => {
          drag.current = null
        }}
      >
        <img
          src={mediaResource(batchId, 'previews', page.preview_id)}
          alt="Orientation-normalized source for crop selection"
          draggable={false}
        />
        {valid && (
          <Selection
            style={{
              left: `${(crop.x / page.width) * 100}%`,
              top: `${(crop.y / page.height) * 100}%`,
              width: `${(crop.width / page.width) * 100}%`,
              height: `${(crop.height / page.height) * 100}%`,
            }}
          />
        )}
      </Canvas>
      <Fields>
        {(['x', 'y', 'width', 'height'] as const).map((field) => (
          <label key={field}>
            {field}
            <input
              type="number"
              step="1"
              min={field === 'x' || field === 'y' ? 0 : 1}
              value={crop[field]}
              disabled={busy}
              onChange={(event) => setCrop({ ...crop, [field]: Number(event.target.value) })}
            />
          </label>
        ))}
        <label>
          Output rotation
          <select
            value={turns}
            disabled={busy}
            onChange={(event) => setTurns(Number(event.target.value))}
          >
            {[0, 1, 2, 3].map((value) => (
              <option key={value} value={value}>
                {value * 90}° clockwise
              </option>
            ))}
          </select>
        </label>
      </Fields>
      <Small>
        Source {page.width} × {page.height}. Crop precedes output rotation. The prepared result
        appears as a new retained version.
      </Small>
      {!valid && (
        <Paragraph role="alert">
          Keep a positive integer crop inside the source dimensions.
        </Paragraph>
      )}
      {error && <Paragraph role="alert">{error}</Paragraph>}
      <Actions>
        <Button disabled={busy} onClick={close}>
          Discard and close
        </Button>
        <Button disabled={busy || !valid} onClick={() => void retainCrop()}>
          {busy ? 'Saving crop request…' : 'Prepare new version'}
        </Button>
      </Actions>
    </Dialog>
  )
}

const Dialog = styled.dialog`
  width: min(1000px, calc(100vw - 32px));
  max-height: calc(100dvh - 32px);
  overflow: auto;
  border: 1px solid #bac7d8;
  border-radius: 8px;
  padding: 20px;
  background: #fff;
  color: #202b3c;

  &::backdrop {
    background: #152238a8;
  }
`

const Canvas = styled.div<{ $ratio: number }>`
  position: relative;
  width: min(100%, 760px);
  aspect-ratio: ${(props) => props.$ratio};
  margin: 16px auto;
  touch-action: none;
  user-select: none;
  background: #eef2f7;

  img {
    display: block;
    width: 100%;
    height: 100%;
    pointer-events: none;
  }
`

const Selection = styled.div`
  position: absolute;
  border: 2px solid #1769aa;
  background: #2680c51f;
  pointer-events: none;
`

const Fields = styled.div`
  display: flex;
  flex-wrap: wrap;
  gap: 12px;

  label {
    display: grid;
    gap: 5px;
    max-width: 160px;
  }

  input,
  select {
    width: 100%;
    padding: 8px;
  }
`

const Actions = styled.div`
  display: flex;
  flex-wrap: wrap;
  justify-content: flex-end;
  gap: 12px;
  margin-top: 16px;
`
