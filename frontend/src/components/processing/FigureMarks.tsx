import { useId } from 'react'
import styled from 'styled-components'
import { VIEW_MARK_UNITS, type MediaViewMarkDto } from '@invimport/contracts'
import { color, font } from '#/theme/generated/tokens'

type Props = {
  marks: readonly MediaViewMarkDto[]
  /** The rendered view's size, so fractions map onto it and circles stay round. */
  width: number
  height: number
}

/**
 * The agent's marks drawn over a picture from their fractions of the view; never part of the
 * image. Hidden from assistive technology, which reads them from the larger view's list.
 */
export function FigureMarks({ marks, width, height }: Props) {
  // A plain fragment, since `url(#…)` must name the marker without React's id punctuation.
  const arrowHead = `figure-arrow-${useId().replace(/[^\w-]/g, '')}`
  if (marks.length === 0) {
    return null
  }
  const labelSize = Math.max(width, height) * LABEL_SIZE_SHARE

  return (
    <Overlay
      data-figure-marks=""
      viewBox={`0 0 ${width} ${height}`}
      preserveAspectRatio="none"
      aria-hidden="true"
      focusable="false"
    >
      <defs>
        <marker
          id={arrowHead}
          viewBox="0 0 10 10"
          refX="8"
          refY="5"
          markerWidth="5"
          markerHeight="5"
          orient="auto-start-reverse"
        >
          <path d="M0 0 L10 5 L0 10 z" className="head" />
        </marker>
      </defs>
      {marks.map((mark, index) => (
        <g key={index}>{markShape({ mark, width, height, arrowHead, labelSize })}</g>
      ))}
    </Overlay>
  )
}

/** A label's text height as a share of the view's long edge, as the agent's preview draws it. */
const LABEL_SIZE_SHARE = 0.028
/** An estimate of a character's width in ems, enough to size the pill around the text. */
const LABEL_CHARACTER_EMS = 0.58

/** A label as an amber pill centred on its point, moved in so the whole pill stays in view. */
function labelPill(
  mark: Extract<MediaViewMarkDto, { kind: 'label' }>,
  width: number,
  height: number,
  size: number,
) {
  const pillWidth = Math.min(width, mark.label.length * size * LABEL_CHARACTER_EMS + size)
  const pillHeight = size * 1.6
  const x = clamp((mark.at.x * width) / VIEW_MARK_UNITS - pillWidth / 2, 0, width - pillWidth)
  const y = clamp((mark.at.y * height) / VIEW_MARK_UNITS - pillHeight / 2, 0, height - pillHeight)
  return (
    <>
      <rect className="pill" x={x} y={y} width={pillWidth} height={pillHeight} rx={size * 0.4} />
      <text
        className="label"
        x={x + pillWidth / 2}
        y={y + pillHeight / 2}
        fontSize={size}
        textAnchor="middle"
        dominantBaseline="central"
      >
        {mark.label}
      </text>
    </>
  )
}

function clamp(value: number, low: number, high: number) {
  return Math.min(Math.max(value, low), Math.max(low, high))
}

type MarkShape = {
  mark: MediaViewMarkDto
  width: number
  height: number
  arrowHead: string
  labelSize: number
}

type Fractions = { x: number; y: number; width: number; height: number }

function markBox(geometry: Fractions, width: number, height: number) {
  return {
    x: (geometry.x * width) / VIEW_MARK_UNITS,
    y: (geometry.y * height) / VIEW_MARK_UNITS,
    w: (geometry.width * width) / VIEW_MARK_UNITS,
    h: (geometry.height * height) / VIEW_MARK_UNITS,
  }
}

/** One mark as SVG, in the view's pixels. */
function markShape({ mark, width, height, arrowHead, labelSize }: MarkShape) {
  switch (mark.kind) {
    case 'label':
      return labelPill(mark, width, height, labelSize)
    case 'arrow':
      return (
        <line
          className="stroke"
          x1={(mark.geometry.from.x * width) / VIEW_MARK_UNITS}
          y1={(mark.geometry.from.y * height) / VIEW_MARK_UNITS}
          x2={(mark.geometry.to.x * width) / VIEW_MARK_UNITS}
          y2={(mark.geometry.to.y * height) / VIEW_MARK_UNITS}
          markerEnd={`url(#${arrowHead})`}
        />
      )
    case 'box':
    case 'highlight': {
      const { x, y, w, h } = markBox(mark.geometry, width, height)
      const className = mark.kind === 'box' ? 'stroke' : 'highlight'
      return <rect className={className} x={x} y={y} width={w} height={h} />
    }
    case 'circle':
    case 'ellipse': {
      const { x, y, w, h } = markBox(mark.geometry, width, height)
      // A circle is drawn round in the middle of its box.
      const radius = mark.kind === 'circle' ? Math.min(w, h) / 2 : undefined
      return (
        <ellipse
          className="stroke"
          cx={x + w / 2}
          cy={y + h / 2}
          rx={radius ?? w / 2}
          ry={radius ?? h / 2}
        />
      )
    }
  }
}

const Overlay = styled.svg`
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  pointer-events: none;
  .stroke {
    fill: none;
    stroke: ${color.highlight};
    stroke-width: 3px;
    vector-effect: non-scaling-stroke;
  }
  .highlight {
    fill: ${color.highlight};
    fill-opacity: 0.35;
  }
  .head {
    fill: ${color.highlight};
  }
  .pill {
    fill: ${color.highlight};
  }
  .label {
    fill: ${color.photoScrim};
    font-family: ${font.sans};
    font-weight: 700;
  }
`
