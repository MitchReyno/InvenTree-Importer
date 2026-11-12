import { Group, LatheGeometry, QuadraticBezierCurve, SplineCurve, Sprite, Vector2 } from 'three'
import { CLEAR_GLASS_OPACITY, fills, INNER_GLOW_RENDER_ORDER } from '#/electronics-current/finishes'
import type { OutlineKit } from '#/electronics-current/outline-kit'
import { createPart, type PartBuilder, type PartType } from '#/electronics-current/part-model'
import { at, box, cylinder, pinRing } from '#/electronics-current/shapes'

function points(pairs: readonly (readonly [number, number])[]): Vector2[] {
  return pairs.map(([x, y]) => new Vector2(x, y))
}

function addHeaterGlow(kit: OutlineKit, group: Group, y: number, width: number, height: number) {
  const glow = new Sprite(kit.tubeGlow)
  glow.position.set(0, y, 0)
  glow.scale.set(width, height, 1)
  glow.renderOrder = INNER_GLOW_RENDER_ORDER
  group.add(glow)
}

// Noval envelope: straight sides, a rounded shoulder and a small pip on top.
const NOVAL_ENVELOPE = [
  [0, 0],
  [0.9, 0],
  [0.95, 0.25],
  [0.95, 3.1],
  [0.86, 3.55],
  [0.55, 3.82],
  [0.22, 3.95],
  [0.13, 4.1],
  [0, 4.18],
] as const

/** Octal power tube: noval-style glass sized for a short, wide bakelite base. */
const octalTube: PartBuilder = ({ kit }) => {
  const group = new Group()
  const baseHeight = 1.1
  const widen = 1.2 / 0.95
  const lengthen = 4.7 / 4.18
  const envelope = points(NOVAL_ENVELOPE).map(
    (point) => new Vector2(point.x * widen, point.y * lengthen + baseHeight),
  )
  const glass = new LatheGeometry(new SplineCurve(envelope).getPoints(44), 32)

  group.add(at(kit.body(cylinder(1.3, baseHeight, 28), fills.darkPlastic), 0, baseHeight / 2, 0))
  group.add(at(kit.body(box(1.5, 2.1, 0.62), fills.steel), 0, 3.4, 0))
  group.add(at(kit.detail(cylinder(1.1, 0.04, 24), fills.mica), 0, 2.25, 0))
  group.add(at(kit.detail(cylinder(1.1, 0.04, 24), fills.mica), 0, 4.55, 0))
  group.add(at(kit.detail(cylinder(0.7, 0.06, 20), fills.aluminium), 0, 5.05, 0))
  group.add(kit.glass(glass, fills.tubeGlass, CLEAR_GLASS_OPACITY))
  addHeaterGlow(kit, group, 3.3, 4.4, 4.8)
  pinRing(kit, group, 8, 0.72, 0.09, 1.2)

  return createPart(group, { scale: 0.85 })
}

// 5U4 glass, in base radii above the base: a short rounded join, straight sides
// tapering out to the widest point, a filleted 45 degree shoulder in to a
// narrower top section, and a rounded dome.
const RECTIFIER_BODY_RADIUS = 1.65

const RECTIFIER_TOP_RADIUS = 1.08

const RECTIFIER_SHOULDER_HEIGHT = 3.2

const RECTIFIER_HEIGHT = 5.42

const RECTIFIER_DOME_HEIGHT = 0.62

const SHOULDER_FILLET = 0.32

/** Softens a bend with a quadratic curve from `SHOULDER_FILLET` before it to after it. */
function roundedCorner(previous: Vector2, corner: Vector2, next: Vector2): Vector2[] {
  const start = corner.clone().add(previous.clone().sub(corner).setLength(SHOULDER_FILLET))
  const end = corner.clone().add(next.clone().sub(corner).setLength(SHOULDER_FILLET))

  return new QuadraticBezierCurve(start, corner, end).getPoints(8)
}

export function rectifierProfile(): Vector2[] {
  const footEnd = new Vector2(1.0, 0.35)
  const foot = new QuadraticBezierCurve(new Vector2(0.9, 0), new Vector2(0.92, 0.22), footEnd)
  const shoulderLow = new Vector2(RECTIFIER_BODY_RADIUS, RECTIFIER_SHOULDER_HEIGHT)
  const shoulderHigh = new Vector2(
    RECTIFIER_TOP_RADIUS,
    RECTIFIER_SHOULDER_HEIGHT + (RECTIFIER_BODY_RADIUS - RECTIFIER_TOP_RADIUS),
  )
  const topStart = new Vector2(RECTIFIER_TOP_RADIUS, RECTIFIER_HEIGHT - RECTIFIER_DOME_HEIGHT)
  const profile = [new Vector2(0, 0), ...foot.getPoints(10)]

  profile.push(...roundedCorner(footEnd, shoulderLow, shoulderHigh))
  profile.push(...roundedCorner(shoulderLow, shoulderHigh, topStart))
  profile.push(topStart)

  for (let index = 1; index <= 16; index++) {
    const angle = (index / 16) * (Math.PI / 2)
    const dome = new Vector2(
      Math.cos(angle) * RECTIFIER_TOP_RADIUS,
      RECTIFIER_HEIGHT - RECTIFIER_DOME_HEIGHT + Math.sin(angle) * RECTIFIER_DOME_HEIGHT,
    )
    profile.push(dome)
  }

  return profile
}

/** 5U4 rectifier: tall base with a key spigot, tapered glass and twin plates. */
const rectifier5u4: PartBuilder = ({ kit }) => {
  const group = new Group()
  const baseHeight = 1.9
  const plateCentre = baseHeight + 2.925
  const glass = new LatheGeometry(
    rectifierProfile().map((point) => new Vector2(point.x, point.y + baseHeight)),
    40,
  )

  group.add(at(kit.body(cylinder(1.0, baseHeight, 32), fills.darkPlastic), 0, baseHeight / 2, 0))
  group.add(
    at(
      kit.glass(cylinder(0.45, 0.7, 16), fills.tubeGlass, CLEAR_GLASS_OPACITY),
      0,
      baseHeight + 0.35,
      0,
    ),
  )

  for (let index = 0; index < 6; index++) {
    const stem = kit.lead(cylinder(0.022, 0.95, 4))
    group.add(at(stem, -0.5 + index * 0.2, baseHeight + 0.47, 0.05))
  }

  group.add(at(kit.detail(cylinder(1.0, 0.04, 24), fills.mica), 0, baseHeight + 0.9, 0))
  group.add(at(kit.body(box(0.26, 4.05, 0.4), fills.steel), -0.45, plateCentre, 0))
  group.add(at(kit.body(box(0.26, 4.05, 0.4), fills.steel), 0.45, plateCentre, 0))

  for (const x of [-0.15, 0, 0.15]) {
    group.add(at(kit.lead(cylinder(0.02, 4.05, 4)), x, plateCentre, 0))
  }

  group.add(at(kit.detail(cylinder(0.85, 0.04, 24), fills.mica), 0, baseHeight + 4.98, 0))
  group.add(kit.glass(glass, fills.tubeGlass, CLEAR_GLASS_OPACITY))
  addHeaterGlow(kit, group, baseHeight + 2.9, 4.4, 6.0)
  group.add(at(kit.body(cylinder(0.22, 0.7, 16), fills.darkPlastic), 0, -0.35, 0))
  pinRing(kit, group, 8, 0.62, 0.09, 1.0)

  return createPart(group, { scale: 0.62 })
}

export const tubeBuilders = {
  octalTube,
  rectifier5u4,
} satisfies Partial<Record<PartType, PartBuilder>>
