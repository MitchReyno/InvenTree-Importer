import {
  observationCropRevision,
  renditionDimensions,
  type MediaRenditionSize,
} from '@invimport/contracts/media'
import { mediaResource, observationCrop } from './types'

/** How an image is shown, which bounds the largest size worth loading. */
export type ImageUsage = 'thumbnail' | 'card' | 'viewer'

/** Attributes for an `<img>`; spread them onto the element. */
export interface ImageAttributes {
  src: string
  srcSet?: string
  sizes?: string
  width: number
  height: number
}

const USAGE_SIZES: Record<ImageUsage, MediaRenditionSize[]> = {
  // A narrow region in a cover-cropped thumbnail can need the view size at high density.
  thumbnail: ['thumb', 'card', 'view'],
  card: ['thumb', 'card'],
  viewer: ['thumb', 'card', 'view'],
}

const DEFAULT_SIZES: Record<ImageUsage, string> = {
  thumbnail: '64px',
  card: '(max-width: 700px) 100vw, 360px',
  viewer: '(max-width: 700px) 100vw, 60vw',
}

/**
 * The candidates a usage may load, from the source's dimensions alone. The full image joins them
 * only when the usage's largest size does not exist because the source is no larger than it, so
 * a high-density screen never skips to a large original.
 */
function attributes(
  dimensions: { width: number; height: number },
  usage: ImageUsage,
  url: (size: MediaRenditionSize | 'full') => string,
  sizes: string,
): ImageAttributes {
  const allowed = USAGE_SIZES[usage]
  const candidates: { url: string; width: number }[] = []
  for (const size of allowed) {
    const sized = renditionDimensions(dimensions.width, dimensions.height, size)
    if (sized) {
      candidates.push({ url: url(size), width: sized.width })
    }
  }
  const largest = allowed[allowed.length - 1]
  if (!renditionDimensions(dimensions.width, dimensions.height, largest)) {
    candidates.push({ url: url('full'), width: dimensions.width })
  }
  // A very narrow source can round several sizes to one width; keep the most detailed of each.
  const unique = [...new Map(candidates.map((item) => [item.width, item])).values()]
  return {
    src: unique[unique.length - 1].url,
    srcSet: unique.map((item) => `${item.url} ${item.width}w`).join(', '),
    sizes,
    width: dimensions.width,
    height: dimensions.height,
  }
}

function sizedUrl(base: string, size: MediaRenditionSize | 'full', extra = '') {
  const query = [size === 'full' ? '' : `size=${size}`, extra].filter(Boolean).join('&')
  return query ? `${base}?${query}` : base
}

/** A decoded page at the size its surface needs. */
export function previewImage(
  batchId: string,
  page: { preview_id: string; width: number; height: number },
  usage: ImageUsage,
  sizes = DEFAULT_SIZES[usage],
): ImageAttributes {
  const base = mediaResource(batchId, 'previews', page.preview_id)
  return attributes(page, usage, (size) => sizedUrl(base, size), sizes)
}

/** A deleted file's thumbnail, the only size the server still serves for it. */
export function removedThumbnail(batchId: string, previewId: string) {
  return sizedUrl(mediaResource(batchId, 'previews', previewId), 'thumb')
}

/** The full-resolution page, for zoomed inspection or opening the image on its own. */
export function fullPreview(
  batchId: string,
  page: { preview_id: string; width: number; height: number },
): ImageAttributes {
  return {
    src: mediaResource(batchId, 'previews', page.preview_id),
    width: page.width,
    height: page.height,
  }
}

type PixelObservation = {
  id: string
  evidence_version_id: string
  page: number
  region: { kind: 'pixels'; x: number; y: number; width: number; height: number }
}

/** An observation's region at the size its surface needs, under its current region revision. */
export function observationImage(
  batchId: string,
  observation: PixelObservation,
  usage: ImageUsage,
  sizes = DEFAULT_SIZES[usage],
): ImageAttributes {
  const base = observationCrop(batchId, observation.id)
  const rev = `rev=${observationCropRevision(
    observation.evidence_version_id,
    observation.page,
    observation.region,
  )}`
  return attributes(observation.region, usage, (size) => sizedUrl(base, size, rev), sizes)
}

/**
 * The `sizes` width for an image drawn with `object-fit: cover` in a fixed box: a wide image
 * fills the box's height, so it needs more width than the box itself.
 */
export function coverSizes(
  box: { width: number; height: number },
  image: { width: number; height: number },
) {
  const widen = Math.max(1, image.width / image.height / (box.width / box.height))
  return `${Math.ceil(box.width * widen)}px`
}

/** Whether a viewer at this zoom and density needs more detail than the view size holds. */
export function needsFullResolution(
  page: { width: number; height: number },
  renderedWidth: number,
  zoom: number,
  devicePixelRatio: number,
) {
  const view = renditionDimensions(page.width, page.height, 'view')
  return view !== null && zoom * renderedWidth * devicePixelRatio > view.width
}
