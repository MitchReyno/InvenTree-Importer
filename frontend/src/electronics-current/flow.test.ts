import { expect, test } from 'vitest'
import {
  FLOW_SPEED,
  SEPARATION_RADIUS,
  STIR_RADIUS_PX,
  flowTarget,
  relaxTowards,
  separate,
  stirFalloff,
  type FlowBody,
} from './flow'

function body(x: number, y: number): FlowBody {
  return { position: { x, y, z: 0 }, velocity: { x: 0, y: 0, z: 0 }, seed: 1 }
}

test('the current drifts left and pulls parts back inside the masthead', () => {
  const inside = flowTarget({ x: 0, y: 0, z: 0 }, 3, 1, 8)
  const above = flowTarget({ x: 0, y: 20, z: 0 }, 3, 1, 8)
  const behind = flowTarget({ x: 0, y: 0, z: -30 }, 3, 1, 8)

  expect(inside.x).toBeLessThan(-FLOW_SPEED * 0.9)
  expect(Math.abs(inside.y)).toBeLessThanOrEqual(1.3)
  expect(above.y).toBeLessThan(-10)
  expect(behind.z).toBeGreaterThan(10)
})

test('velocity eases towards the target without overshooting', () => {
  const velocity = { x: 0, y: 0, z: 0 }

  relaxTowards(velocity, { x: -3, y: 1, z: 0 }, 0.5)

  expect(velocity.x).toBeLessThan(0)
  expect(velocity.x).toBeGreaterThan(-3)
  expect(velocity.y).toBeGreaterThan(0)
  expect(velocity.y).toBeLessThan(1)
})

test('separation pushes close neighbours apart symmetrically and ignores distant ones', () => {
  const left = body(0, 0)
  const right = body(2, 0)
  const distant = body(SEPARATION_RADIUS + 5, 0)

  separate([left, right, distant], 0.1)

  expect(left.velocity.x).toBeLessThan(0)
  expect(right.velocity.x).toBeCloseTo(-left.velocity.x)
  expect(distant.velocity.x).toBe(0)
})

test('pointer influence is strongest at the pointer and vanishes at its reach', () => {
  expect(stirFalloff(0, 1)).toBe(1)
  expect(stirFalloff(STIR_RADIUS_PX / 2, 1)).toBeCloseTo(0.25)
  expect(stirFalloff(STIR_RADIUS_PX, 1)).toBe(0)
  expect(stirFalloff(STIR_RADIUS_PX * 2, 1)).toBe(0)
})
