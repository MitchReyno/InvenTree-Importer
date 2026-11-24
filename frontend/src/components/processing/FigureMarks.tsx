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
/** The space between a shape and its label, in label heights. */
const LABEL_GAP_SIZES = 0.3

type PillSize = { width: number; height: number }

/** A label pill's size, so it can be placed before it is drawn. */
function pillSize(text: string, viewWidth: number, size: number): PillSize {
  return {
    width: Math.min(viewWidth, text.length * size * LABEL_CHARACTER_EMS + size),
    height: size * 1.6,
  }
}

type Pill = {
  text: string
  /** The pill's wanted top left, moved in so the whole pill stays in view. */
  left: number
  top: number
  width: number
  height: number
  size: number
}

/** An amber pill with its text, as the agent's preview draws it. */
function labelPill({ text, left, top, width, height, size }: Pill) {
  const pill = pillSize(text, width, size)
  const x = clamp(left, 0, width - pill.width)
  const y = clamp(top, 0, height - pill.height)
  return (
    <>
      <rect className="pill" x={x} y={y} width={pill.width} height={pill.height} rx={size * 0.4} />
      <text
        className="label"
        x={x + pill.width / 2}
        y={y + pill.height / 2}
        fontSize={size}
        textAnchor="middle"
        dominantBaseline="central"
      >
        {text}
      </text>
    </>
  )
}

/** A label centred on a point. */
function centredPill(text: string, point: { x: number; y: number }, shape: MarkShape) {
  const pill = pillSize(text, shape.width, shape.labelSize)
  return labelPill({
    text,
    left: point.x - pill.width / 2,
    top: point.y - pill.height / 2,
    width: shape.width,
    height: shape.height,
    size: shape.labelSize,
  })
}

/** A box-like mark's label sits below it, or above it when there is no room below. */
function boxPill(text: string, box: { x: number; y: number; h: number }, shape: MarkShape) {
  const pill = pillSize(text, shape.width, shape.labelSize)
  const gap = shape.labelSize * LABEL_GAP_SIZES
  const below = box.y + box.h + gap
  const top = below + pill.height <= shape.height ? below : box.y - gap - pill.height
  return labelPill({
    text,
    left: box.x,
    top,
    width: shape.width,
    height: shape.height,
    size: shape.labelSize,
  })
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

/** One mark as SVG, in the view's pixels, with its label where the agent's preview draws it. */
function markShape(shape: MarkShape) {
  const { mark, width, height, arrowHead } = shape
  switch (mark.kind) {
    case 'label': {
      const at = {
        x: (mark.at.x * width) / VIEW_MARK_UNITS,
        y: (mark.at.y * height) / VIEW_MARK_UNITS,
      }
      return centredPill(mark.label, at, shape)
    }
    case 'arrow': {
      const from = {
        x: (mark.geometry.from.x * width) / VIEW_MARK_UNITS,
        y: (mark.geometry.from.y * height) / VIEW_MARK_UNITS,
      }
      return (
        <>
          <line
            className="stroke"
            x1={from.x}
            y1={from.y}
            x2={(mark.geometry.to.x * width) / VIEW_MARK_UNITS}
            y2={(mark.geometry.to.y * height) / VIEW_MARK_UNITS}
            markerEnd={`url(#${arrowHead})`}
          />
          {/* At the tail, away from what the arrow points at. */}
          {mark.label ? centredPill(mark.label, from, shape) : null}
        </>
      )
    }
    case 'box':
    case 'highlight': {
      const box = markBox(mark.geometry, width, height)
      const className = mark.kind === 'box' ? 'stroke' : 'highlight'
      return (
        <>
          <rect className={className} x={box.x} y={box.y} width={box.w} height={box.h} />
          {mark.label ? boxPill(mark.label, box, shape) : null}
        </>
      )
    }
    case 'circle':
    case 'ellipse': {
      const box = markBox(mark.geometry, width, height)
      // A circle is drawn round in the middle of its box.
      const radius = mark.kind === 'circle' ? Math.min(box.w, box.h) / 2 : undefined
      return (
        <>
          <ellipse
            className="stroke"
            cx={box.x + box.w / 2}
            cy={box.y + box.h / 2}
            rx={radius ?? box.w / 2}
            ry={radius ?? box.h / 2}
          />
          {mark.label ? boxPill(mark.label, box, shape) : null}
        </>
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
