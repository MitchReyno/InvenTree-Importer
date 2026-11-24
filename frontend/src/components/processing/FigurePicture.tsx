import { useState } from 'react'
import styled from 'styled-components'
import type { ProcessingQuestionFigureDto } from '@invimport/contracts'
import { figureAspect, figureStateText } from '#/processing/question-figures'
import { color, space, typeVar } from '#/theme/generated/tokens'
import { FigureMarks } from './FigureMarks'

type Props = {
  figure: ProcessingQuestionFigureDto
  /** The figure route's view or thumbnail. */
  src: string
  showMarks: boolean
  /** A thumbnail's smaller placeholder text. */
  compact?: boolean
  /** An id for the text shown in place of the picture, so its button can be described by it. */
  statusId?: string
}

/**
 * A question picture at the view's shape, filling its container's width, with the agent's marks
 * over it. A picture that can't be shown says why in its place.
 */
export function FigurePicture({ figure, src, showMarks, compact = false, statusId }: Props) {
  // The read can say ready a moment before the route serves it, or after the photo went.
  const [failedSrc, setFailedSrc] = useState<string | null>(null)
  const { width, height } = figureAspect(figure)
  const unavailable =
    figureStateText(figure.state) ?? (failedSrc === src ? 'Picture couldn’t be loaded' : undefined)

  return (
    <Frame $ratio={`${width} / ${height}`} data-figure-state={figure.state}>
      {unavailable ? (
        <Placeholder id={statusId} $compact={compact}>
          {unavailable}
        </Placeholder>
      ) : (
        <>
          <img src={src} alt="" draggable={false} onError={() => setFailedSrc(src)} />
          {showMarks && <FigureMarks marks={figure.marks ?? []} width={width} height={height} />}
        </>
      )}
    </Frame>
  )
}

const Frame = styled.span<{ $ratio: string }>`
  position: relative;
  display: block;
  width: 100%;
  aspect-ratio: ${({ $ratio }) => $ratio};
  overflow: hidden;
  background: ${color.photoStage};
  img {
    display: block;
    width: 100%;
    height: 100%;
  }
`

const Placeholder = styled.span<{ $compact: boolean }>`
  position: absolute;
  inset: 0;
  display: grid;
  place-items: center;
  padding: ${space[3]};
  color: ${color.photoFg};
  font-size: ${({ $compact }) => ($compact ? typeVar.label.size : typeVar.small.size)};
  text-align: center;
`
