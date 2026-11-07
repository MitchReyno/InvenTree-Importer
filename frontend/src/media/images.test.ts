import { describe, expect, it } from 'vitest'
import { coverSizes, needsFullResolution, observationImage, previewImage } from './images'

const page = (width: number, height: number) => ({ preview_id: 'p', width, height })

const base = '/api/v1/batches/b/media/previews/p'

const widths = (srcSet?: string) =>
  srcSet?.split(', ').map((candidate) => candidate.split(' ')) ?? []

describe('previewImage', () => {
  it('offers a large photo only the sizes its usage allows, never the full page', () => {
    const card = previewImage('b', page(4032, 3024), 'card')
    expect(widths(card.srcSet)).toEqual([
      [`${base}?size=thumb`, '320w'],
      [`${base}?size=card`, '960w'],
    ])
    expect(card.src).toBe(`${base}?size=card`)
    expect([card.width, card.height]).toEqual([4032, 3024])
    const viewer = previewImage('b', page(4032, 3024), 'viewer')
    expect(widths(viewer.srcSet).map(([, width]) => width)).toEqual(['320w', '960w', '2048w'])
    expect(viewer.srcSet).not.toContain(`${base} `)
  })

  it('adds the full page when the source is too small to have the largest size', () => {
    const card = previewImage('b', page(800, 600), 'card')
    expect(widths(card.srcSet)).toEqual([
      [`${base}?size=thumb`, '320w'],
      [base, '800w'],
    ])
    expect(card.src).toBe(base)
    expect(previewImage('b', page(300, 200), 'card').srcSet).toBe(`${base} 300w`)
  })

  it('depends only on the page dimensions, so it is the same before and after a backfill', () => {
    expect(previewImage('b', page(2400, 1600), 'card')).toEqual(
      previewImage('b', page(2400, 1600), 'card'),
    )
  })
})

describe('observationImage', () => {
  const observation = (width: number, height: number) => ({
    id: 'o',
    evidence_version_id: 'v',
    page: 1,
    region: { kind: 'pixels' as const, x: 5, y: 6, width, height },
  })

  const crop = '/api/v1/batches/b/media/observations/o/crop'

  it('sizes from the region, under its revision', () => {
    const landscape = observationImage('b', observation(1800, 1200), 'card')
    expect(widths(landscape.srcSet)).toEqual([
      [`${crop}?size=thumb&rev=v-1-5-6-1800-1200`, '320w'],
      [`${crop}?size=card&rev=v-1-5-6-1800-1200`, '960w'],
    ])
    expect([landscape.width, landscape.height]).toEqual([1800, 1200])
    // A portrait region scales its long edge, so its thumb is 128 pixels wide.
    expect(widths(observationImage('b', observation(1200, 3000), 'card').srcSet)[0][1]).toBe('128w')
    expect(observationImage('b', observation(200, 150), 'thumbnail').srcSet).toBe(
      `${crop}?rev=v-1-5-6-200-150 200w`,
    )
  })

  it('lets a narrow region in a cover thumbnail reach the view size at high density', () => {
    const region = observation(3600, 400)
    const image = observationImage(
      'b',
      region,
      'thumbnail',
      coverSizes({ width: 64, height: 64 }, region.region),
    )
    // 64 px × 9 wide = 576 CSS px, 1728 pixels at 3×, so the 2048 px view crop qualifies.
    expect(image.sizes).toBe('576px')
    expect(widths(image.srcSet).map(([, width]) => width)).toEqual(['320w', '960w', '2048w'])
  })
})

describe('needsFullResolution', () => {
  it('promotes once zoom × width × density exceeds the view width, and never below it', () => {
    const large = { width: 4032, height: 3024 }
    expect(needsFullResolution(large, 1024, 2, 1)).toBe(false)
    expect(needsFullResolution(large, 1025, 2, 1)).toBe(true)
    expect(needsFullResolution(large, 900, 1, 3)).toBe(true)
    expect(needsFullResolution(large, 900, 1, 2)).toBe(false)
    expect(needsFullResolution({ width: 900, height: 1200 }, 900, 3, 3)).toBe(false)
  })
})
