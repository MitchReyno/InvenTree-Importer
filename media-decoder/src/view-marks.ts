import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { createCanvas, GlobalFonts, ImageData, type SKRSContext2D } from '@napi-rs/canvas'
import { VIEW_MARK_UNITS, type MediaViewMarkDto } from '@invimport/contracts/media'

/**
 * The decoder image has no system fonts, so labels use a font file that ships with pdfjs-dist,
 * a production dependency. Registering it under our own family keeps text identical everywhere.
 */
export const MARK_FONT_FAMILY = 'Bench Intake Mark'
const MARK_FONT_FILE = 'LiberationSans-Bold.ttf'

const MARK_STROKE = '#ffb020'
const HIGHLIGHT_FILL = 'rgba(255, 216, 107, 0.4)'
const LABEL_TEXT = '#1b211d'
/** Stroke width as a share of the view's long edge, so marks look the same at every size. */
const STROKE_SHARE_OF_LONG_EDGE = 0.006
const MIN_STROKE_PX = 3
const LABEL_FONT_SHARE_OF_LONG_EDGE = 0.028
const MIN_LABEL_FONT_PX = 14
/** Arrow head length in stroke widths. */
const ARROW_HEAD_STROKES = 5
const ARROW_HEAD_HALF_ANGLE_RADIANS = Math.PI / 7

/** Registers the bundled label font once and returns its family. */
export function markFont(): string {
  if (GlobalFonts.has(MARK_FONT_FAMILY)) {
    return MARK_FONT_FAMILY
  }
  const require = createRequire(import.meta.url)
  const root = dirname(require.resolve('pdfjs-dist/package.json'))
  const registered = GlobalFonts.registerFromPath(
    join(root, 'standard_fonts', MARK_FONT_FILE),
    MARK_FONT_FAMILY,
  )
  if (!registered) {
    throw new Error('mark_font_unavailable')
  }
  return MARK_FONT_FAMILY
}

interface MarkStyle {
  width: number
  height: number
  stroke: number
  fontSize: number
  font: string
}

interface Box {
  x: number
  y: number
  width: number
  height: number
}

function markStyle(width: number, height: number): MarkStyle {
  const longEdge = Math.max(width, height)
  const fontSize = Math.max(MIN_LABEL_FONT_PX, Math.round(longEdge * LABEL_FONT_SHARE_OF_LONG_EDGE))
  return {
    width,
    height,
    stroke: Math.max(MIN_STROKE_PX, Math.round(longEdge * STROKE_SHARE_OF_LONG_EDGE)),
    fontSize,
    font: `${fontSize}px "${markFont()}"`,
  }
}

function pixelBox(geometry: Box, style: MarkStyle): Box {
  return {
    x: (geometry.x * style.width) / VIEW_MARK_UNITS,
    y: (geometry.y * style.height) / VIEW_MARK_UNITS,
    width: (geometry.width * style.width) / VIEW_MARK_UNITS,
    height: (geometry.height * style.height) / VIEW_MARK_UNITS,
  }
}

function clamp(value: number, minimum: number, maximum: number) {
  return Math.min(Math.max(value, minimum), Math.max(minimum, maximum))
}

/**
 * The label pill's size for a text, in pixels. A pill wider than the view is drawn in a smaller
 * font so the whole label shows; the operator's overlay fits its labels the same way.
 */
function pillSize(context: SKRSContext2D, text: string, style: MarkStyle) {
  context.font = style.font
  const natural = context.measureText(text).width + style.fontSize * PILL_PADDING_EMS * 2
  const fontSize =
    natural > style.width ? Math.max(1, (style.fontSize * style.width) / natural) : style.fontSize
  const font = `${fontSize}px "${markFont()}"`
  context.font = font
  const padding = fontSize * PILL_PADDING_EMS
  return {
    width: Math.min(style.width, context.measureText(text).width + padding * 2),
    height: fontSize * 1.6,
    padding,
    font,
  }
}

/** A pill's padding either side of its text, in ems. */
const PILL_PADDING_EMS = 0.6

/** Draws a filled amber pill with dark text, its top left at (x, y), kept inside the view. */
function drawPill(context: SKRSContext2D, text: string, x: number, y: number, style: MarkStyle) {
  const size = pillSize(context, text, style)
  const left = clamp(x, 0, style.width - size.width)
  const top = clamp(y, 0, style.height - size.height)
  context.fillStyle = MARK_STROKE
  context.beginPath()
  context.roundRect(left, top, size.width, size.height, size.height / 2)
  context.fill()
  context.fillStyle = LABEL_TEXT
  context.font = size.font
  context.textBaseline = 'middle'
  context.textAlign = 'left'
  // At the smallest sizes the measure can still exceed the view; the text is held to the pill.
  context.fillText(text, left + size.padding, top + size.height / 2, size.width - size.padding * 2)
}

/** A box-like mark's label sits below it, or above it when there is no room below. */
function drawBoxLabel(context: SKRSContext2D, text: string, box: Box, style: MarkStyle) {
  const gap = style.stroke * 2
  const size = pillSize(context, text, style)
  const below = box.y + box.height + gap
  const top = below + size.height <= style.height ? below : box.y - gap - size.height
  drawPill(context, text, box.x, top, style)
}

function drawArrow(
  context: SKRSContext2D,
  from: { x: number; y: number },
  to: { x: number; y: number },
  style: MarkStyle,
) {
  const angle = Math.atan2(to.y - from.y, to.x - from.x)
  const headLength = style.stroke * ARROW_HEAD_STROKES
  context.beginPath()
  context.moveTo(from.x, from.y)
  // Stop the shaft inside the head so its square end doesn't poke past the point.
  context.lineTo(
    to.x - Math.cos(angle) * headLength * 0.5,
    to.y - Math.sin(angle) * headLength * 0.5,
  )
  context.stroke()
  context.beginPath()
  context.moveTo(to.x, to.y)
  for (const side of [-1, 1]) {
    const wing = angle + Math.PI + side * ARROW_HEAD_HALF_ANGLE_RADIANS
    context.lineTo(to.x + Math.cos(wing) * headLength, to.y + Math.sin(wing) * headLength)
  }
  context.closePath()
  context.fillStyle = MARK_STROKE
  context.fill()
}

function drawMark(context: SKRSContext2D, mark: MediaViewMarkDto, style: MarkStyle) {
  context.strokeStyle = MARK_STROKE
  context.lineWidth = style.stroke
  context.lineJoin = 'round'
  context.lineCap = 'round'
  switch (mark.kind) {
    case 'label': {
      const size = pillSize(context, mark.label, style)
      const x = (mark.at.x * style.width) / VIEW_MARK_UNITS - size.width / 2
      const y = (mark.at.y * style.height) / VIEW_MARK_UNITS - size.height / 2
      drawPill(context, mark.label, x, y, style)
      return
    }
    case 'arrow': {
      const from = {
        x: (mark.geometry.from.x * style.width) / VIEW_MARK_UNITS,
        y: (mark.geometry.from.y * style.height) / VIEW_MARK_UNITS,
      }
      const to = {
        x: (mark.geometry.to.x * style.width) / VIEW_MARK_UNITS,
        y: (mark.geometry.to.y * style.height) / VIEW_MARK_UNITS,
      }
      drawArrow(context, from, to, style)
      if (mark.label) {
        // The tail is away from the subject, so the label covers nothing the arrow points at.
        const size = pillSize(context, mark.label, style)
        drawPill(context, mark.label, from.x - size.width / 2, from.y - size.height / 2, style)
      }
      return
    }
    case 'box':
    case 'circle':
    case 'ellipse':
    case 'highlight': {
      const box = pixelBox(mark.geometry, style)
      drawShape(context, mark.kind, box)
      if (mark.label) {
        drawBoxLabel(context, mark.label, box, style)
      }
      return
    }
  }
}

function drawShape(
  context: SKRSContext2D,
  kind: 'box' | 'circle' | 'ellipse' | 'highlight',
  box: Box,
) {
  const centerX = box.x + box.width / 2
  const centerY = box.y + box.height / 2
  context.beginPath()
  switch (kind) {
    case 'box':
      context.rect(box.x, box.y, box.width, box.height)
      context.stroke()
      return
    case 'circle':
      context.arc(centerX, centerY, Math.min(box.width, box.height) / 2, 0, Math.PI * 2)
      context.stroke()
      return
    case 'ellipse':
      context.ellipse(centerX, centerY, box.width / 2, box.height / 2, 0, 0, Math.PI * 2)
      context.stroke()
      return
    case 'highlight':
      context.fillStyle = HIGHLIGHT_FILL
      context.fillRect(box.x, box.y, box.width, box.height)
      return
  }
}

/** Draws the marks, in order, over RGBA pixels of the rendered view and encodes a PNG. */
export async function drawMarks(
  rgba: Buffer,
  size: { width: number; height: number },
  marks: MediaViewMarkDto[],
): Promise<Buffer> {
  const canvas = createCanvas(size.width, size.height)
  try {
    const context = canvas.getContext('2d')
    const pixels = new Uint8ClampedArray(rgba.buffer, rgba.byteOffset, rgba.length)
    context.putImageData(new ImageData(pixels, size.width, size.height), 0, 0)
    const style = markStyle(size.width, size.height)
    for (const mark of marks) {
      drawMark(context, mark, style)
    }
    return await canvas.encode('png')
  } finally {
    canvas.width = 0
    canvas.height = 0
  }
}
