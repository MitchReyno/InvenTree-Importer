import Moveable from 'react-moveable'
import { useEffect, useRef, useState } from 'react'
import styled from 'styled-components'
import type { CropFrame } from '../../media/crop-model'

interface Props {
  source: string
  sourceWidth: number
  sourceHeight: number
  frame: CropFrame
  aspectLocked: boolean
  disabled: boolean
  change: (frame: CropFrame) => void
}

/** Moveable owns gestures on this overlay only. The normalized source image stays fixed. */
export function RotatedCropSelection({
  source,
  sourceWidth,
  sourceHeight,
  frame,
  aspectLocked,
  disabled,
  change,
}: Props) {
  const surface = useRef<HTMLDivElement>(null)
  const selection = useRef<HTMLDivElement>(null)
  const moveable = useRef<Moveable>(null)
  const [surfaceWidth, setSurfaceWidth] = useState(0)
  const scale = surfaceWidth / sourceWidth

  useEffect(() => {
    const element = surface.current
    if (!element) {
      return
    }
    const observer = new ResizeObserver(([entry]) => setSurfaceWidth(entry.contentRect.width))
    observer.observe(element)
    return () => observer.disconnect()
  }, [])

  useEffect(() => {
    moveable.current?.updateRect()
  }, [frame, surfaceWidth])

  function translatedFrame(
    translation: number[],
    width: number,
    height: number,
    degrees: number,
  ): CropFrame {
    return {
      centerX: (translation[0] + width / 2) / scale,
      centerY: (translation[1] + height / 2) / scale,
      width: width / scale,
      height: height / scale,
      degrees,
    }
  }

  const width = frame.width * scale
  const height = frame.height * scale
  const left = frame.centerX * scale - width / 2
  const top = frame.centerY * scale - height / 2

  return (
    <SourceSurface ref={surface} $ratio={sourceWidth / sourceHeight}>
      <SourceImage src={source} alt="Fixed orientation-normalized source" draggable={false} />
      <CropTarget
        ref={selection}
        aria-label="Rotating crop selection"
        style={{
          width,
          height,
          transform: `translate(${left}px, ${top}px) rotate(${frame.degrees}deg)`,
        }}
      />
      {surfaceWidth > 0 && !disabled && (
        <Moveable
          ref={moveable}
          target={selection}
          draggable
          resizable
          rotatable
          origin={false}
          rotationPosition="none"
          rotateAroundControls
          controlPadding={24}
          renderDirections={['nw', 'ne', 'sw', 'se']}
          keepRatio={aspectLocked}
          throttleDrag={0}
          throttleResize={0}
          throttleRotate={0.001}
          onDrag={(event) =>
            change(translatedFrame(event.beforeTranslate, width, height, frame.degrees))
          }
          onResize={(event) =>
            change(
              translatedFrame(event.drag.beforeTranslate, event.width, event.height, frame.degrees),
            )
          }
          onRotate={(event) =>
            change(translatedFrame(event.drag.beforeTranslate, width, height, event.beforeRotate))
          }
        />
      )}
    </SourceSurface>
  )
}

const SourceSurface = styled.div<{ $ratio: number }>`
  position: relative;
  aspect-ratio: ${(props) => props.$ratio};
  margin: 36px;
  touch-action: none;
  background: #edf1f6;
`
const SourceImage = styled.img`
  display: block;
  width: 100%;
  height: 100%;
  object-fit: contain;
  pointer-events: none;
  user-select: none;
`
const CropTarget = styled.div`
  position: absolute;
  left: 0;
  top: 0;
  transform-origin: 50% 50%;
  box-sizing: border-box;
  border: 2px solid #266ac5;
  background: rgb(38 106 197 / 12%);
  cursor: move;
`
