import { Mesh, Sprite } from 'three'
import { afterEach, expect, test } from 'vitest'
import { PART_WEIGHTS, partBuilders, pickPartType } from './catalogue'
import { createOutlineKit, type OutlineKit } from './outline-kit'
import type { PartType } from './part-model'

const kits: OutlineKit[] = []

function sequence(values: number[]): () => number {
  let index = 0

  return () => {
    const value = values[index % values.length]
    index += 1

    return value
  }
}

afterEach(() => {
  kits.splice(0).forEach((kit) => kit.dispose())
})

test('every part type has a builder and a positive weight', () => {
  const types = Object.keys(PART_WEIGHTS) as PartType[]

  expect(new Set(Object.keys(partBuilders))).toEqual(new Set(types))
  types.forEach((type) => expect(PART_WEIGHTS[type]).toBeGreaterThan(0))
})

test('weighted picking reaches every type and favours resistors', () => {
  const picks = new Map<PartType, number>()
  const samples = 2000

  for (let index = 0; index < samples; index++) {
    const type = pickPartType(() => (index + 0.5) / samples)
    picks.set(type, (picks.get(type) ?? 0) + 1)
  }

  expect(picks.size).toBe(Object.keys(PART_WEIGHTS).length)
  const resistorShare = (picks.get('resistor') ?? 0) / samples
  expect(resistorShare).toBeGreaterThan(0.1)
  expect(Math.max(...picks.values())).toBe(picks.get('resistor'))
})

test('every builder produces real geometry with its declared behaviour', () => {
  const kit = createOutlineKit()
  kits.push(kit)

  for (const [type, build] of Object.entries(partBuilders) as [
    PartType,
    typeof partBuilders.led,
  ][]) {
    for (const randomValue of [0.05, 0.5, 0.95]) {
      const part = build({ kit, random: sequence([randomValue, 0.3, 0.7]) })
      let meshes = 0
      part.group.traverse((child) => {
        if (child instanceof Mesh) {
          meshes += 1
        }
      })

      expect(meshes, type).toBeGreaterThan(0)
      expect(part.scale, type).toBeGreaterThan(0)
    }
  }
})

test('LEDs carry a glow and displays drift towards the viewer', () => {
  const kit = createOutlineKit()
  kits.push(kit)
  const led = partBuilders.led({ kit, random: () => 0.2 })
  const display = partBuilders.display14({ kit, random: () => 0.2 })
  const glows: Sprite[] = []
  led.group.traverse((child) => {
    if (child instanceof Sprite) {
      glows.push(child)
    }
  })

  expect(led.led).toBeDefined()
  expect(glows).toHaveLength(1)
  expect(display.facesViewer).toBe(true)
  expect(display.display?.digits).toHaveLength(2)
  led.led?.dispose()
})
