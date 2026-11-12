import {
  BufferAttribute,
  BufferGeometry,
  CylinderGeometry,
  Group,
  LatheGeometry,
  LineLoop,
  Mesh,
  RingGeometry,
  Vector2,
  Vector3,
} from 'three'
import { fills, PLASTIC_FILLS } from '#/electronics-current/finishes'
import type { OutlineKit } from '#/electronics-current/outline-kit'
import {
  createPart,
  type HangingFrame,
  type HangingPart,
  type PartBuilder,
  type PartType,
} from '#/electronics-current/part-model'
import { createRope, stepRope, type Rope } from '#/electronics-current/rope'
import { pick } from '#/electronics-current/shapes'

/** Where the loose end leaves the case, on the rim below the hub. */
export const WICK_ANCHOR = new Vector3(0.55, -1.5, 0.08)

const ROPE_POINTS = 12

const SEGMENT_LENGTH = 0.17

const RIBBON_HALF_WIDTH = 0.15

const TUBE_GLASS_OPACITY = 0.4

const LABEL_COLOURS = [PLASTIC_FILLS[0], PLASTIC_FILLS[2], fills.wickOrange] as const

// The white wedge of the label, where the brand and size are printed.
const LABEL_WEDGE_START = 2.3

const LABEL_WEDGE = 1.9

// Clear dish profile: a flat front, a lipped rim and a shallow back.
const CASE_PROFILE = [
  [0, 0.32],
  [1.58, 0.32],
  [1.62, 0.27],
  [1.56, 0.16],
  [1.22, -0.18],
  [1.02, -0.3],
  [0, -0.3],
] as const

// Cross-section of the wound braid: an annulus between the hub and the case.
const COIL_PROFILE = [
  [0.5, -0.16],
  [1.12, -0.16],
  [1.12, 0.16],
  [0.5, 0.16],
  [0.5, -0.16],
] as const

/** A lathe turned to face +z, so the dispenser's axis matches the label's. */
function faceOn(profile: readonly (readonly [number, number])[], segments: number): LatheGeometry {
  const lathe = new LatheGeometry(
    profile.map(([x, y]) => new Vector2(x, y)),
    segments,
  )
  lathe.rotateX(Math.PI / 2)

  return lathe
}

function addLabel(kit: OutlineKit, group: Group, colour: number): void {
  const coloured = new RingGeometry(
    0.56,
    1.48,
    40,
    1,
    LABEL_WEDGE_START + LABEL_WEDGE,
    Math.PI * 2 - LABEL_WEDGE,
  )
  const printed = new RingGeometry(0.56, 1.48, 16, 1, LABEL_WEDGE_START, LABEL_WEDGE)
  const label = kit.detail(coloured, colour)
  const blank = kit.detail(printed, fills.label)
  label.position.z = 0.33
  blank.position.z = 0.33
  group.add(label, blank)
}

/** A flat strip along the rope, two vertices per point, plus its outline loop. */
function createRibbon(kit: OutlineKit): { fill: Mesh; edge: LineLoop } {
  const surface = new BufferGeometry()
  const index: number[] = []

  for (let point = 0; point < ROPE_POINTS - 1; point++) {
    const left = point * 2
    index.push(left, left + 1, left + 2, left + 1, left + 3, left + 2)
  }

  surface.setAttribute('position', new BufferAttribute(new Float32Array(ROPE_POINTS * 6), 3))
  surface.setIndex(index)
  const outline = new BufferGeometry()
  outline.setAttribute('position', new BufferAttribute(new Float32Array(ROPE_POINTS * 6), 3))
  const fill = new Mesh(surface, kit.ribbon.fill)
  const edge = new LineLoop(outline, kit.ribbon.edge)
  // World-space geometry moves every frame, so its bounds are never current.
  fill.frustumCulled = false
  edge.frustumCulled = false

  return { fill, edge }
}

const tangent = new Vector3()

const across = new Vector3()

const fallback = new Vector3()

/** Width direction at a rope point: the spool axis, made perpendicular to the strip. */
function widthAt(rope: Rope, index: number, axis: Vector3): Vector3 {
  const before = rope.points[Math.max(0, index - 1)].position
  const after = rope.points[Math.min(ROPE_POINTS - 1, index + 1)].position
  tangent.set(after.x - before.x, after.y - before.y, after.z - before.z).normalize()
  across.copy(axis).addScaledVector(tangent, -axis.dot(tangent))

  if (across.lengthSq() < 1e-8) {
    fallback.set(tangent.y, -tangent.x, 0)

    if (fallback.lengthSq() < 1e-8) {
      fallback.set(1, 0, 0)
    }

    across.copy(fallback)
  }

  return across.normalize()
}

function createHanging(kit: OutlineKit, group: Group): HangingPart {
  const rope = createRope(ROPE_POINTS, SEGMENT_LENGTH)
  const { fill, edge } = createRibbon(kit)
  const surface = fill.geometry.getAttribute('position') as BufferAttribute
  const outline = edge.geometry.getAttribute('position') as BufferAttribute
  const anchor = new Vector3()
  const axis = new Vector3()

  function writeRibbon(halfWidth: number): void {
    rope.points.forEach(({ position }, index) => {
      const width = widthAt(rope, index, axis).multiplyScalar(halfWidth)
      const leftX = position.x - width.x
      const leftY = position.y - width.y
      const leftZ = position.z - width.z
      const rightX = position.x + width.x
      const rightY = position.y + width.y
      const rightZ = position.z + width.z
      surface.setXYZ(index * 2, leftX, leftY, leftZ)
      surface.setXYZ(index * 2 + 1, rightX, rightY, rightZ)
      // The outline runs down the left edge and back up the right.
      outline.setXYZ(index, leftX, leftY, leftZ)
      outline.setXYZ(ROPE_POINTS * 2 - 1 - index, rightX, rightY, rightZ)
    })
    surface.needsUpdate = true
    outline.needsUpdate = true
  }

  function update(frame: HangingFrame): void {
    group.updateWorldMatrix(true, false)
    const scale = group.matrixWorld.getMaxScaleOnAxis()
    group.localToWorld(anchor.copy(WICK_ANCHOR))
    axis.set(0, 0, 1).transformDirection(group.matrixWorld)
    rope.segmentLength = SEGMENT_LENGTH * scale
    const nudge =
      frame.pointer && frame.frameSeconds > 0 ? { ...frame, pointer: frame.pointer } : null
    stepRope(rope, anchor, frame.frameSeconds, nudge)

    writeRibbon(RIBBON_HALF_WIDTH * scale)
  }

  return {
    objects: [fill, edge],
    update,
    dispose: () => {
      fill.geometry.dispose()
      edge.geometry.dispose()
    },
  }
}

/** Solder wick in a clear dish dispenser, its loose end hanging from the rim. */
const solderWick: PartBuilder = ({ kit, random }) => {
  const group = new Group()
  const hub = new CylinderGeometry(0.3, 0.3, 0.64, 20)
  hub.rotateX(Math.PI / 2)

  group.add(kit.body(faceOn(COIL_PROFILE, 36), fills.copper))
  group.add(kit.detail(hub, fills.hole))
  addLabel(kit, group, pick(LABEL_COLOURS, random))
  group.add(kit.glass(faceOn(CASE_PROFILE, 40), fills.tubeGlass, TUBE_GLASS_OPACITY))

  return createPart(group, { hanging: createHanging(kit, group) })
}

export const wickBuilders = {
  solderWick,
} satisfies Partial<Record<PartType, PartBuilder>>
