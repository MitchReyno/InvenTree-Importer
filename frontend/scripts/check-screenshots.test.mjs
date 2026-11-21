import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import check from './check-screenshots.cjs'

const { comparePixels, decodePng, encodePng, fixturePages, scenarios, shotName } = check

function image(width, height, fill) {
  const data = Buffer.alloc(width * height * 4)
  for (let index = 0; index < width * height; index++) {
    data.set(fill(index % width, Math.floor(index / width)), index * 4)
  }
  return { width, height, data }
}

describe('screenshot diff', () => {
  it('round-trips RGBA pixels through its PNG encoder and decoder', () => {
    const original = image(3, 2, (x, y) => [x * 80, y * 120, 40, 255])
    const decoded = decodePng(encodePng(original))

    expect(decoded.width).toBe(3)
    expect(decoded.height).toBe(2)
    expect([...decoded.data]).toEqual([...original.data])
  })

  it('counts every differing pixel and marks it in the diff image', () => {
    const before = image(4, 4, () => [255, 255, 255, 255])
    const after = image(4, 4, (x, y) =>
      x === 1 && y === 2 ? [254, 255, 255, 255] : [255, 255, 255, 255],
    )

    const result = comparePixels(before, after)

    expect(result.changed).toBe(1)
    expect(result.sizeChanged).toBe(false)
    const marked = (2 * 4 + 1) * 4
    expect([...result.diff.data.subarray(marked, marked + 4)]).toEqual([255, 0, 64, 255])
  })

  it('reports identical images as unchanged', () => {
    const shot = image(2, 2, () => [10, 20, 30, 255])

    expect(
      comparePixels(
        shot,
        image(2, 2, () => [10, 20, 30, 255]),
      ).changed,
    ).toBe(0)
  })

  it('treats a page that changed height as changed in every extra row', () => {
    const before = image(2, 2, () => [0, 0, 0, 255])
    const after = image(2, 3, () => [0, 0, 0, 255])

    const result = comparePixels(before, after)

    expect(result.sizeChanged).toBe(true)
    expect(result.changed).toBe(2)
  })

  it('covers every fixture page in both themes at desktop and phone width', () => {
    const root = mkdtempSync(join(tmpdir(), 'fixtures-'))
    mkdirSync(join(root, 'nested'))
    writeFileSync(join(root, 'b.html'), '')
    writeFileSync(join(root, 'a.html'), '')
    writeFileSync(join(root, 'notes.md'), '')

    const pages = fixturePages(root)

    expect(pages).toEqual(['a.html', 'b.html'])
    expect(scenarios(pages).map(shotName)).toEqual([
      'a-light-1440.png',
      'a-light-390.png',
      'a-dark-1440.png',
      'a-dark-390.png',
      'b-light-1440.png',
      'b-light-390.png',
      'b-dark-1440.png',
      'b-dark-390.png',
    ])
  })
})
