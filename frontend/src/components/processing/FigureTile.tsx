import styled from 'styled-components'
import type { ProcessingQuestionFigureDto } from '@invimport/contracts'
import { ExpandIcon } from '#/components/ui'
import { figureSourceLine, pageBadge } from '#/processing/question-figures'
import { color, icon, radius, ring, space, type, typeVar } from '#/theme/generated/tokens'
import { FigurePicture } from './FigurePicture'

type Props = {
  figure: ProcessingQuestionFigureDto
  /** Counting from 0, in the agent's order. */
  index: number
  count: number
  src: string
  /** "A" and "B" for a pair, "1 / 4" for the large picture of a strip. */
  badge?: string
  onOpen: () => void
}

/** One question picture with its caption and source; the picture opens the larger view. */
export function FigureTile({ figure, index, count, src, badge, onOpen }: Props) {
  const page = pageBadge(figure)

  return (
    <Figure>
      <Open
        type="button"
        aria-label={`Open picture ${index + 1} of ${count}: ${figure.caption}`}
        onClick={onOpen}
      >
        <FigurePicture figure={figure} src={src} showMarks />
        {badge && <Corner aria-hidden="true">{badge}</Corner>}
        {page && <Page aria-hidden="true">{page}</Page>}
        <Larger aria-hidden="true">
          <ExpandIcon />
        </Larger>
      </Open>
      <figcaption>
        <span>{figure.caption}</span>
        <Source>{figureSourceLine(figure)}</Source>
      </figcaption>
    </Figure>
  )
}

const Figure = styled.figure`
  display: flex;
  flex-direction: column;
  gap: ${space[2]};
  min-width: 0;
  margin: 0;
  figcaption {
    display: flex;
    flex-direction: column;
    gap: ${space[1]};
    font-size: ${typeVar.small.size};
    overflow-wrap: anywhere;
  }
`

const Open = styled.button`
  position: relative;
  display: block;
  width: 100%;
  padding: 0;
  overflow: hidden;
  border: 1px solid ${color.line};
  border-radius: ${radius.card};
  background: ${color.photoStage};
  cursor: zoom-in;
  &:focus-visible {
    outline: ${ring.width} solid ${color.accent};
    outline-offset: ${ring.offset};
  }
`

const Chip = styled.span`
  position: absolute;
  top: ${space[3]};
  padding: ${space[1]} ${space[3]};
  border-radius: ${radius.pill};
  ${type.pill}
  line-height: 1;
`

const Corner = styled(Chip)`
  left: ${space[3]};
  background: ${color.photoScrim};
  color: ${color.photoFg};
`

const Page = styled(Chip)`
  right: ${space[3]};
  background: ${color.surface};
  color: ${color.fg};
`

const Larger = styled.span`
  position: absolute;
  right: ${space[3]};
  bottom: ${space[3]};
  display: inline-grid;
  place-items: center;
  width: ${icon.lg};
  height: ${icon.lg};
  border-radius: ${radius.sm};
  background: ${color.photoScrim};
  color: ${color.photoFg};
  svg {
    width: ${icon.sm};
    height: ${icon.sm};
  }
`

const Source = styled.span`
  color: ${color.muted};
`
