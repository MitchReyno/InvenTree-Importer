import styled from 'styled-components'
import type { ProcessingQuestionFigureDto } from '@invimport/contracts'
import { useFigurePagePreview } from '#/media/useFigurePagePreview'
import { color, space, typeVar } from '#/theme/generated/tokens'

type Props = {
  figure: ProcessingQuestionFigureDto
  batchId: string
}

/**
 * The whole page a picture was cut from, with the picture's region outlined. Without a readable
 * page preview the outline is drawn on a page-shaped box and says so.
 */
export function FigureWholePage({ figure, batchId }: Props) {
  const preview = useFigurePagePreview(batchId, figure.source)
  const { page_width: width, page_height: height } = figure
  const { region, straighten_millidegrees: angle } = figure.view
  const centerX = region.x + region.width / 2
  const centerY = region.y + region.height / 2
  const label = figure.evidence_label ?? 'The page'

  return (
    <Frame $ratio={`${width} / ${height}`}>
      {preview.state === 'ready' && (
        <img
          data-testid="whole-page"
          src={preview.image.src}
          srcSet={preview.image.srcSet}
          sizes={preview.image.sizes}
          alt=""
          draggable={false}
        />
      )}
      {preview.state === 'unavailable' && (
        <Unavailable>
          The page preview isn’t available here; the outline shows where the picture sits on the
          page.
        </Unavailable>
      )}
      <svg
        viewBox={`0 0 ${width} ${height}`}
        preserveAspectRatio="none"
        role="img"
        aria-label={`${label} with the picture’s region outlined`}
      >
        {/* The view samples the region turned against its straightening angle. */}
        <rect
          data-region-outline=""
          x={region.x}
          y={region.y}
          width={region.width}
          height={region.height}
          transform={`rotate(${-angle / 1000} ${centerX} ${centerY})`}
        />
      </svg>
    </Frame>
  )
}

const Frame = styled.div<{ $ratio: string }>`
  position: relative;
  width: 100%;
  aspect-ratio: ${({ $ratio }) => $ratio};
  background: ${color.photoStage};
  img,
  svg {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
  }
  rect {
    fill: none;
    stroke: ${color.highlight};
    stroke-width: 3px;
    vector-effect: non-scaling-stroke;
  }
`

const Unavailable = styled.p`
  position: absolute;
  inset: auto 0 0;
  margin: 0;
  padding: ${space[4]} ${space[6]};
  color: ${color.photoFg};
  font-size: ${typeVar.small.size};
`
