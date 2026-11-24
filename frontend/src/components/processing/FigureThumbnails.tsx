import { useRef, type KeyboardEvent } from 'react'
import styled from 'styled-components'
import type { ProcessingQuestionFigureDto } from '@invimport/contracts'
import { color, radius, ring, space } from '#/theme/generated/tokens'
import { FigurePicture } from './FigurePicture'

const ARROW_STEP: Partial<Record<string, number>> = { ArrowLeft: -1, ArrowRight: 1 }

type Props = {
  figures: readonly ProcessingQuestionFigureDto[]
  /** The picture shown, counting from 0. */
  current: number
  onSelect: (index: number) => void
  label: string
  thumbSrc: (index: number) => string
  large?: boolean
}

/**
 * The question's pictures as a strip of thumbnails, the shown one marked current. One tab stop;
 * Left and Right show the previous or next picture and move focus with it.
 */
export function FigureThumbnails({
  figures,
  current,
  onSelect,
  label,
  thumbSrc,
  large = false,
}: Props) {
  const buttons = useRef<(HTMLButtonElement | null)[]>([])

  function handleKeyDown(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    const step = ARROW_STEP[event.key]
    if (step === undefined) {
      return
    }
    // Handled here, so an enclosing dialog doesn't move a second time.
    event.preventDefault()
    const next = index + step
    if (next < 0 || next >= figures.length) {
      return
    }
    onSelect(next)
    buttons.current[next]?.focus()
  }

  return (
    <Strip role="group" aria-label={label}>
      {figures.map((figure, index) => (
        <Thumb
          key={index}
          ref={(element) => {
            buttons.current[index] = element
          }}
          type="button"
          $large={large}
          aria-label={`Picture ${index + 1}: ${figure.caption}`}
          aria-current={index === current ? 'true' : undefined}
          tabIndex={index === current ? 0 : -1}
          onClick={() => onSelect(index)}
          onKeyDown={(event) => handleKeyDown(event, index)}
        >
          <FigurePicture figure={figure} src={thumbSrc(index)} showMarks compact />
        </Thumb>
      ))}
    </Strip>
  )
}

const Strip = styled.div`
  display: flex;
  gap: ${space[3]};
  overflow-x: auto;
  padding: ${space[1]};
`

const Thumb = styled.button<{ $large: boolean }>`
  flex: none;
  align-self: flex-start;
  width: ${({ $large }) => ($large ? '96px' : '68px')};
  padding: 0;
  overflow: hidden;
  border: 2px solid transparent;
  border-radius: ${radius.input};
  background: none;
  cursor: pointer;
  &[aria-current='true'] {
    border-color: ${color.accent};
  }
  &:focus-visible {
    outline: ${ring.width} solid ${color.accent};
    outline-offset: ${ring.offset};
  }
`
