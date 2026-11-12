import { CapsuleGeometry, LinearFilter, Mesh, MeshBasicMaterial } from 'three'
import { expect, test } from 'vitest'
import { FINISHES, fillFor, fills } from './finishes'
import { createHullGeometry, createOutlineKit } from './outline-kit'
import { box } from './shapes'

test('glass parts share one material per colour so recycling never accumulates them', () => {
  const kit = createOutlineKit()
  const first = kit.glass(new CapsuleGeometry(0.38, 1.2, 6, 18), fills.glass)
  const second = kit.glass(new CapsuleGeometry(0.38, 1.2, 6, 18), fills.glass)

  expect(first.material).toBe(second.material)
  expect(first.renderOrder).toBeLessThan((first.children[0] as Mesh).renderOrder)
  kit.dispose()
})

test('bodies get a silhouette and creases; details get creases only', () => {
  const kit = createOutlineKit()
  const body = kit.body(box(1, 1, 1), fills.epoxy)
  const detail = kit.detail(box(1, 0.04, 1), fills.marking)

  const silhouettes = (mesh: Mesh) => mesh.children.filter((child) => child instanceof Mesh)

  expect(silhouettes(body)).toHaveLength(1)
  expect(silhouettes(detail)).toHaveLength(0)
  expect(body.material).toBe(kit.body(box(2, 2, 2), fills.epoxy).material)
  kit.dispose()
})

test('outline shells use normals averaged across hard edges', () => {
  const hull = createHullGeometry(box(1, 1, 1))
  const smooth = hull.getAttribute('smoothNormal')

  expect(smooth.count).toBe(hull.getAttribute('position').count)

  for (let index = 0; index < smooth.count; index++) {
    const length = Math.hypot(smooth.getX(index), smooth.getY(index), smooth.getZ(index))
    expect(length).toBeCloseTo(1)
    // Box corners average three face normals, so no component is a pure axis.
    expect(Math.abs(smooth.getX(index))).toBeLessThan(0.99)
  }
})

test('the glow texture is linearly filtered so stretched glows stay smooth', () => {
  const kit = createOutlineKit()

  expect(kit.glowTexture.magFilter).toBe(LinearFilter)
  expect(kit.glowTexture.minFilter).toBe(LinearFilter)
  expect(kit.displays.every((display) => display.lit instanceof MeshBasicMaterial)).toBe(true)
  kit.dispose()
})

test('a theme change re-tints the same materials in place', () => {
  const kit = createOutlineKit('light')
  const body = kit.body(box(1, 1, 1), fills.epoxy)
  const fill = body.material as MeshBasicMaterial
  const hull = (body.children[0] as Mesh).material as MeshBasicMaterial
  const led = kit.createLed(0xe0503c)

  expect(fill.color.getHex()).toBe(fills.epoxy)
  expect(hull.color.getHex()).toBe(FINISHES.light.outline)

  kit.setTheme('dark')

  expect(body.material).toBe(fill)
  expect(fill.color.getHex()).toBe(fillFor(fills.epoxy, 'dark').getHex())
  expect(hull.color.getHex()).toBe(FINISHES.dark.outline)
  expect(kit.baseFill.getHex()).toBe(FINISHES.dark.base)
  expect(led.fill.color.getHex()).toBe(FINISHES.dark.base)

  kit.setTheme('light')
  expect(fill.color.getHex()).toBe(fills.epoxy)
  expect(hull.color.getHex()).toBe(FINISHES.light.outline)
  kit.dispose()
})

test('parts built while dark start with the dark finish, and disposed LEDs stop re-tinting', () => {
  const kit = createOutlineKit('dark')
  const detail = kit.detail(box(1, 0.04, 1), fills.marking)
  const led = kit.createLed(0x3fbf7f)
  const crease = led.crease.color.getHex()

  expect((detail.material as MeshBasicMaterial).color.getHex()).toBe(
    fillFor(fills.marking, 'dark').getHex(),
  )
  led.dispose()
  kit.setTheme('light')
  expect(led.crease.color.getHex()).toBe(crease)
  kit.dispose()
})

test('glass opacity variants are cached per colour and opacity and still shared', () => {
  const kit = createOutlineKit()
  const tube = kit.glass(box(1, 1, 1), fills.tubeGlass, 0.4)
  const sameTube = kit.glass(box(1, 1, 1), fills.tubeGlass, 0.4)
  const standard = kit.glass(box(1, 1, 1), fills.tubeGlass)

  expect(tube.material).toBe(sameTube.material)
  expect(tube.material).not.toBe(standard.material)
  expect((tube.material as MeshBasicMaterial).opacity).toBe(0.4)
  kit.dispose()
})

test('unlit Nixie cathodes are translucent and never hide the lit numeral', () => {
  const kit = createOutlineKit()

  expect(kit.nixie.unlit.transparent).toBe(true)
  expect(kit.nixie.unlit.depthWrite).toBe(false)
  expect(kit.nixie.lit.transparent).toBe(true)
  kit.dispose()
})

test('tube glass, Nixie cathodes and the wick ribbon re-tint with the theme', () => {
  const kit = createOutlineKit('light')
  const tube = kit.glass(box(1, 1, 1), fills.tubeGlass, 0.4)

  kit.setTheme('dark')

  expect((tube.material as MeshBasicMaterial).color.getHex()).toBe(
    fillFor(fills.tubeGlass, 'dark').getHex(),
  )
  expect(kit.nixie.unlit.color.getHex()).toBe(fillFor(fills.unlitCathode, 'dark').getHex())
  expect(kit.ribbon.fill.color.getHex()).toBe(fillFor(fills.copper, 'dark').getHex())
  expect(kit.ribbon.edge.color.getHex()).toBe(FINISHES.dark.outline)
  kit.dispose()
})
