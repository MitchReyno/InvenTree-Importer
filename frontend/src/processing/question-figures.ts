import {
  viewLayout,
  type MediaViewMarkDto,
  type ProcessingQuestionFigureDto,
  type ViewLayout,
} from '@invimport/contracts'

/** Where the view samples its page and the size it renders at; undefined if the read is malformed. */
export function figureLayout(figure: ProcessingQuestionFigureDto): ViewLayout | undefined {
  try {
    return viewLayout({
      page_width: figure.page_width,
      page_height: figure.page_height,
      view: figure.view,
    })
  } catch {
    return undefined
  }
}

/** The rendered view's aspect, from its layout, else the region turned as the view turns it. */
export function figureAspect(figure: ProcessingQuestionFigureDto, layout = figureLayout(figure)) {
  if (layout) {
    return { width: layout.width, height: layout.height }
  }
  const { width, height } = figure.view.region
  return figure.view.quarter_turns % 2 === 1 ? { width: height, height: width } : { width, height }
}

/** "×4" when the view is enlarged from its page; nothing when shown at its size or smaller. */
export function zoomText(layout: ViewLayout | undefined) {
  if (!layout || layout.scale <= 1) {
    return undefined
  }
  const rounded = Math.round(layout.scale * 10) / 10

  return `×${Number.isInteger(rounded) ? rounded.toFixed(0) : rounded.toFixed(1)}`
}

function cropped(figure: ProcessingQuestionFigureDto) {
  const { region } = figure.view
  return (
    region.x > 0 ||
    region.y > 0 ||
    region.width < figure.page_width ||
    region.height < figure.page_height
  )
}

/** What the view did to its page, in the order it is done: "cropped, turned upright, ×4". */
export function figureAdjustments(
  figure: ProcessingQuestionFigureDto,
  layout = figureLayout(figure),
) {
  const adjustments: string[] = []
  if (cropped(figure)) {
    adjustments.push('cropped')
  }
  if (figure.view.quarter_turns !== 0) {
    adjustments.push('turned upright')
  }
  if (figure.view.straighten_millidegrees !== 0) {
    adjustments.push('straightened')
  }
  const zoom = zoomText(layout)
  if (zoom) {
    adjustments.push(zoom)
  }

  return adjustments
}

/** A figure's source line under its caption: "IMG_3011 · cropped, turned upright, ×4". */
export function figureSourceLine(figure: ProcessingQuestionFigureDto) {
  const label = figure.evidence_label ?? 'A photo in this batch'
  const adjustments = figureAdjustments(figure)
  const shown = adjustments.length > 0 ? adjustments.join(', ') : 'the whole page'

  return `${label} · ${shown}`
}

/** "Region 1840, 1210, 900 × 500 · ×3 · turned upright · straightened 2.5°", for the larger view. */
export function figureShownLine(figure: ProcessingQuestionFigureDto) {
  const { region, quarter_turns: turns, straighten_millidegrees: angle } = figure.view
  const parts = [`Region ${region.x}, ${region.y}, ${region.width} × ${region.height}`]
  const zoom = zoomText(figureLayout(figure))
  if (zoom) {
    parts.push(zoom)
  }
  if (turns !== 0) {
    parts.push(`turned ${turns * 90}°`)
  }
  if (angle !== 0) {
    parts.push(`straightened ${Math.abs(angle) / 1000}°`)
  }

  return parts.join(' · ')
}

/** A document page beyond the first carries a page badge: "p. 12". */
export function pageBadge(figure: ProcessingQuestionFigureDto) {
  return figure.document ? `p. ${figure.source.page}` : undefined
}

const MARK_NAME: Record<MediaViewMarkDto['kind'], string> = {
  box: 'Box',
  circle: 'Circle',
  ellipse: 'Ellipse',
  highlight: 'Highlight',
  arrow: 'Arrow',
  label: 'Label',
}

/** A mark in words, as the larger view lists it: "Box: the suffix in doubt", "Label: “Worn”". */
export function markText(mark: MediaViewMarkDto) {
  if (mark.kind === 'label') {
    return `Label: “${mark.label}”`
  }
  const name = MARK_NAME[mark.kind]

  return mark.label ? `${name}: ${mark.label}` : name
}

/** What shows in place of a picture that can't be shown; undefined for a ready one. */
export function figureStateText(state: ProcessingQuestionFigureDto['state']) {
  switch (state) {
    case 'ready':
      return undefined
    case 'preparing':
      return 'Preparing picture…'
    case 'failed':
      return 'Picture couldn’t be made'
    case 'removed':
      return 'Photo removed'
  }
}
