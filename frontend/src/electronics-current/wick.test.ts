import { Group, Mesh, Vector3 } from 'three'
import { afterEach, expect, test, vi } from 'vitest'
import { createOutlineKit, type OutlineKit } from './outline-kit'
import type { HangingFrame, HangingPart } from './part-model'
import { WICK_ANCHOR, wickBuilders } from './parts/wick'

const STILL: HangingFrame = {
  frameSeconds: 0,
  right: new Vector3(1, 0, 0),
  up: new Vector3(0, 1, 0),
  pointer: null,
  unitsPerPx: 0.17,
}

const kits: OutlineKit[] = []

afterEach(() => {
  kits.splice(0).forEach((kit) => kit.dispose())
})

function buildWick(): { holder: Group; hanging: HangingPart } {
  const kit = createOutlineKit()
  kits.push(kit)
  const part = wickBuilders.solderWick({ kit, random: () => 0.2 })
  const holder = new Group()
  holder.add(part.group)

  if (!part.hanging) {
    throw new Error('the solder wick should have a hanging loose end')
  }

  return { holder, hanging: part.hanging }
}

/** Midpoint of the ribbon's cross-section at rope point `index`. */
function ribbonPoint(hanging: HangingPart, index: number): Vector3 {
  const positions = (hanging.objects[0] as Mesh).geometry.getAttribute('position')
  const left = new Vector3().fromBufferAttribute(positions, index * 2)
  const right = new Vector3().fromBufferAttribute(positions, index * 2 + 1)

  return left.add(right).multiplyScalar(0.5)
}

test('a still frame hangs the loose end straight down from the rim', () => {
  const { holder, hanging } = buildWick()
  holder.updateMatrixWorld(true)

  hanging.update(STILL)

  const rim = ribbonPoint(hanging, 0)
  const end = ribbonPoint(hanging, 11)
  expect(rim.distanceTo(WICK_ANCHOR)).toBeLessThan(1e-6)
  expect(end.x).toBeCloseTo(rim.x)
  expect(end.y).toBeLessThan(rim.y - 1.5)
})

test('the loose end stays on the rim and finite as the dispenser turns', () => {
  const { holder, hanging } = buildWick()
  hanging.update(STILL)
  holder.rotation.z = Math.PI / 2
  holder.position.set(4, -2, 1)
  holder.updateMatrixWorld(true)

  for (let frame = 0; frame < 180; frame++) {
    hanging.update({ ...STILL, frameSeconds: 1 / 60 })
  }

  const rim = holder.localToWorld(WICK_ANCHOR.clone())
  const positions = (hanging.objects[0] as Mesh).geometry.getAttribute('position')
  expect(ribbonPoint(hanging, 0).distanceTo(rim)).toBeLessThan(1e-6)
  expect(Array.from(positions.array).every(Number.isFinite)).toBe(true)
  expect(ribbonPoint(hanging, 11).y).toBeLessThan(rim.y - 1.5)
})

test('disposing the loose end releases its geometry', () => {
  const { hanging } = buildWick()
  const disposals = hanging.objects.map((object) => vi.spyOn((object as Mesh).geometry, 'dispose'))

  hanging.dispose()

  disposals.forEach((dispose) => expect(dispose).toHaveBeenCalledTimes(1))
})
