import Moveable from 'react-moveable'
import { useEffect, useRef, useState } from 'react'
import styled from 'styled-components'
import { color } from '../../theme/generated/tokens'
import { cropAspect, type CropAspect, type CropFrame } from '../../media/crop-model'

interface Props {
  source: string
  sourceWidth: number
  sourceHeight: number
  frame: CropFrame
  aspect: CropAspect
  disabled: boolean
  change: (frame: CropFrame) => void
}

/** Moveable owns gestures on this overlay only. The normalized source image stays fixed. */
export function RotatedCropSelection({
  source,
  sourceWidth,
  sourceHeight,
  frame,
  aspect,
  disabled,
  change,
}: Props) {
  const surface = useRef<HTMLDivElement>(null)
  const selection = useRef<HTMLDivElement>(null)
  const moveable = useRef<Moveable>(null)
  const [surfaceWidth, setSurfaceWidth] = useState(0)
  const scale = surfaceWidth / sourceWidth
  const ratio = cropAspect(aspect)

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
      centerX: Math.round(((translation[0] + width / 2) / scale) * 1000000) / 1000000,
      centerY: Math.round(((translation[1] + height / 2) / scale) * 1000000) / 1000000,
      width: Math.round((width / scale) * 1000000) / 1000000,
      height: Math.round((height / scale) * 1000000) / 1000000,
      degrees: Math.round(degrees * 1000) / 1000,
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
          keepRatio={ratio !== null}
          throttleDrag={0}
          throttleResize={0}
          throttleRotate={0.001}
          onDrag={(event) =>
            change(translatedFrame(event.beforeTranslate, width, height, frame.degrees))
          }
          onResize={(event) => {
            // CSS layout rounds dimensions; the retained source ratio remains exact.
            const resizedHeight = ratio ? (event.width * ratio.height) / ratio.width : event.height
            change(
              translatedFrame(
                event.drag.beforeTranslate,
                event.width,
                resizedHeight,
                frame.degrees,
              ),
            )
          }}
          onRotate={(event) =>
            change({ ...frame, degrees: Math.round(event.beforeRotate * 1000) / 1000 })
          }
        />
      )}
    </SourceSurface>
  )
}

const SourceSurface = styled.div<{ $ratio: number }>`
  position: relative;
  aspect-ratio: ${(props) => props.$ratio};
  width: min(calc(100% - 72px), 680px, calc((100dvh - 340px) * ${(props) => props.$ratio}));
  margin: 36px auto;
  touch-action: none;
  background: ${color.photoStage};
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
  border: 2px solid ${color.highlight};
  background: transparent;
  cursor: move;
`
