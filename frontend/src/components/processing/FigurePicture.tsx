import { useEffect, useRef, useState } from 'react'
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
  // The read can say ready a moment before the route serves it, or a load can fail on the way,
  // so a failed load is tried again a few times before the picture says it couldn't be loaded,
  // and then slowly for as long as it is shown, so it appears once the route serves it.
  const [loading, setLoading] = useState<LoadAttempt>({ src, retries: 0, failed: false })
  const retryTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const attempt = loading.src === src ? loading : { src, retries: 0, failed: false }
  const { width, height } = figureAspect(figure)
  const unavailable =
    figureStateText(figure.state) ?? (attempt.failed ? 'Picture couldn’t be loaded' : undefined)
  const imageSrc = attempt.retries === 0 ? src : `${src}?retry=${attempt.retries}`

  // The retry timer is the external system; it is cleared if the picture goes first.
  useEffect(() => () => clearTimeout(retryTimer.current), [])

  function handleError() {
    const failed = attempt.retries >= MAX_LOAD_RETRIES
    const delayMs = failed ? SLOW_RETRY_DELAY_MS : LOAD_RETRY_DELAY_MS * (attempt.retries + 1)
    setLoading({ ...attempt, failed })
    clearTimeout(retryTimer.current)
    retryTimer.current = setTimeout(
      () => setLoading({ src, retries: attempt.retries + 1, failed }),
      delayMs,
    )
  }

  function handleLoad() {
    if (attempt.failed) {
      setLoading({ ...attempt, failed: false })
    }
  }

  return (
    <Frame $ratio={`${width} / ${height}`} data-figure-state={figure.state}>
      {/* One image throughout: after its retries it stays asked for, hidden, until it loads. */}
      {figure.state === 'ready' && (
        <img
          src={imageSrc}
          alt=""
          draggable={false}
          hidden={attempt.failed}
          onError={handleError}
          onLoad={handleLoad}
        />
      )}
      {unavailable ? (
        <Placeholder id={statusId} $compact={compact}>
          {unavailable}
        </Placeholder>
      ) : (
        showMarks && <FigureMarks marks={figure.marks ?? []} width={width} height={height} />
      )}
    </Frame>
  )
}

type LoadAttempt = { src: string; retries: number; failed: boolean }

/** A picture that fails to load is tried again this many times, each a little later. */
const MAX_LOAD_RETRIES = 3
const LOAD_RETRY_DELAY_MS = 2_000
/** After the retries, a picture is asked for again this often while it is shown. */
const SLOW_RETRY_DELAY_MS = 30_000

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
  img[hidden] {
    display: none;
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
