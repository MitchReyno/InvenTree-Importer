import { expect, test } from 'vitest'
import type { Vec3 } from './flow'
import { createRope, nudgeRope, stepRope, type Rope } from './rope'

const FRAME = 1 / 60

const RIGHT: Vec3 = { x: 1, y: 0, z: 0 }

const UP: Vec3 = { x: 0, y: 1, z: 0 }

function run(rope: Rope, anchor: Vec3, frames: number): void {
  for (let frame = 0; frame < frames; frame++) {
    stepRope(rope, anchor, FRAME)
  }
}

function tip(rope: Rope): Vec3 {
  return rope.points[rope.points.length - 1].position
}

function segmentLengths(rope: Rope): number[] {
  return rope.points.slice(1).map((point, index) => {
    const before = rope.points[index].position

    return Math.hypot(
      point.position.x - before.x,
      point.position.y - before.y,
      point.position.z - before.z,
    )
  })
}

function allFinite(rope: Rope): boolean {
  return rope.points.every(({ position }) =>
    [position.x, position.y, position.z].every(Number.isFinite),
  )
}

test('a still frame hangs the rope straight down from its anchor at its set length', () => {
  const rope = createRope(12, 0.2)
  const anchor = { x: 1, y: 2, z: 3 }

  stepRope(rope, anchor, 0)

  expect(tip(rope).x).toBeCloseTo(1)
  expect(tip(rope).y).toBeCloseTo(2 - 11 * 0.2)
  expect(tip(rope).z).toBeCloseTo(3)
  segmentLengths(rope).forEach((length) => expect(length).toBeCloseTo(0.2))
})

test('the rope follows a moving anchor, keeps its length and settles back under it', () => {
  const rope = createRope(12, 0.2)
  const anchor = { x: 0, y: 0, z: 0 }
  stepRope(rope, anchor, 0)

  for (let frame = 0; frame < 30; frame++) {
    anchor.x += 0.15
    stepRope(rope, anchor, FRAME)
  }

  const swung = tip(rope).x
  run(rope, anchor, 600)

  expect(swung).toBeLessThan(anchor.x - 0.1)
  expect(tip(rope).x).toBeCloseTo(anchor.x, 1)
  expect(tip(rope).y).toBeCloseTo(-11 * 0.2, 1)
  segmentLengths(rope).forEach((length) => expect(length).toBeCloseTo(0.2, 2))
  expect(allFinite(rope)).toBe(true)
})

test('the pointer pushes nearby points and leaves distant ones alone', () => {
  const anchor = { x: 0, y: 0, z: 0 }
  const nudged = createRope(12, 0.2)
  const still = createRope(12, 0.2)
  stepRope(nudged, anchor, 0)
  stepRope(still, anchor, 0)
  const near = { x: 0.3, y: -1.2, velocityX: -40, velocityY: 0 }
  const far = { x: 50, y: 50, velocityX: -40, velocityY: 0 }

  nudgeRope(nudged, { pointer: near, right: RIGHT, up: UP, unitsPerPx: 0.17, frameSeconds: FRAME })
  nudgeRope(still, { pointer: far, right: RIGHT, up: UP, unitsPerPx: 0.17, frameSeconds: FRAME })

  expect(tip(nudged).x).toBeLessThan(0)
  expect(tip(still).x).toBe(0)
})

test('coincident points and zero frame time never produce NaN', () => {
  const rope = createRope(6, 0.2)
  const anchor = { x: 0, y: 0, z: 0 }
  rope.settled = true

  stepRope(rope, anchor, 0)
  run(rope, anchor, 60)

  expect(allFinite(rope)).toBe(true)
  segmentLengths(rope).forEach((length) => expect(length).toBeCloseTo(0.2, 1))
})
