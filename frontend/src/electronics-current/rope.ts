// A short hanging rope for loose ends: Verlet points under gravity with the
// first point pinned to an anchor, held at a fixed spacing by distance constraints.
import { stirFalloff, type PointerFlow, type Vec3 } from './flow'

export interface RopePoint {
  position: Vec3
  previous: Vec3
}

export interface Rope {
  points: RopePoint[]
  segmentLength: number
  /** False until the first step hangs the rope straight down from its anchor. */
  settled: boolean
  /** Length of the last step that moved the rope, so velocity carries across uneven frames. */
  lastStepSeconds: number
}

export interface RopeNudge {
  pointer: PointerFlow
  /** Camera axes, so the pointer distance is measured on the screen plane. */
  right: Vec3
  up: Vec3
  unitsPerPx: number
  frameSeconds: number
}

/** Downward acceleration in scene units per second squared; strong enough to read at masthead scale. */
const GRAVITY = 30

/** Velocity lost per second, so swings die away within a few seconds at any frame rate. */
const DAMPING_PER_SECOND = 0.9

// Enough passes that gravity cannot visibly stretch a dozen-point rope.
const CONSTRAINT_PASSES = 30

/** Below this separation two points have no direction to be pushed apart along. */
const MIN_SEPARATION = 1e-6

/** Share of the pointer's own motion passed to the rope it brushes. */
const POINTER_DRAG = 0.7

/** How fast the pointer pushes the rope aside, in scene units per second at full influence. */
const POINTER_PUSH_SPEED = 3

/** Largest pointer shift per point per step, as a share of a segment, so a flick cannot whip the end. */
const MAX_NUDGE_SEGMENTS = 0.5

export function createRope(count: number, segmentLength: number): Rope {
  const points = Array.from({ length: count }, () => ({
    position: { x: 0, y: 0, z: 0 },
    previous: { x: 0, y: 0, z: 0 },
  }))

  return { points, segmentLength, settled: false, lastStepSeconds: 1 / 60 }
}

function hangStraight(rope: Rope, anchor: Vec3): void {
  rope.points.forEach((point, index) => {
    point.position = { x: anchor.x, y: anchor.y - index * rope.segmentLength, z: anchor.z }
    point.previous = { ...point.position }
  })
  rope.settled = true
}

/** Time-corrected Verlet: last step's movement rescaled to this step's length, then damped. */
function integrate(point: RopePoint, frameSeconds: number, lastStepSeconds: number): void {
  const { position, previous } = point
  const carry = (frameSeconds / lastStepSeconds) * Math.exp(-DAMPING_PER_SECOND * frameSeconds)
  const velocity = {
    x: (position.x - previous.x) * carry,
    y: (position.y - previous.y) * carry,
    z: (position.z - previous.z) * carry,
  }
  point.previous = { ...position }
  position.x += velocity.x
  position.y += velocity.y - GRAVITY * frameSeconds * frameSeconds
  position.z += velocity.z
}

/** Moves a pair back to `rest` apart; a pinned first point stays put. */
function constrain(first: Vec3, second: Vec3, rest: number, firstPinned: boolean): void {
  const dx = second.x - first.x
  const dy = second.y - first.y
  const dz = second.z - first.z
  const length = Math.sqrt(dx * dx + dy * dy + dz * dz)

  if (length < MIN_SEPARATION) {
    return
  }

  const correction = (length - rest) / length
  const secondShare = firstPinned ? 1 : 0.5
  const firstShare = 1 - secondShare
  first.x += dx * correction * firstShare
  first.y += dy * correction * firstShare
  first.z += dz * correction * firstShare
  second.x -= dx * correction * secondShare
  second.y -= dy * correction * secondShare
  second.z -= dz * correction * secondShare
}

/**
 * Advances the rope one frame with its first point at `anchor`. A new rope first hangs
 * straight down; 0 seconds adds no motion and only follows the anchor. A pointer nudge is
 * applied before the constraints, so the rope keeps its length.
 */
export function stepRope(
  rope: Rope,
  anchor: Vec3,
  frameSeconds: number,
  nudge: RopeNudge | null = null,
): void {
  if (!rope.settled) {
    hangStraight(rope, anchor)
  }

  const [pinned, ...free] = rope.points

  if (frameSeconds > 0) {
    free.forEach((point) => integrate(point, frameSeconds, rope.lastStepSeconds))
    rope.lastStepSeconds = frameSeconds
  }
  pinned.position = { ...anchor }
  pinned.previous = { ...anchor }

  if (nudge) {
    nudgeRope(rope, nudge)
  }

  for (let pass = 0; pass < CONSTRAINT_PASSES; pass++) {
    for (let index = 0; index < rope.points.length - 1; index++) {
      const first = rope.points[index].position
      const second = rope.points[index + 1].position
      constrain(first, second, rope.segmentLength, index === 0)
    }
  }

  holdLength(rope)
}

/** Places each point exactly one segment from the one before it, so the rope never stretches. */
function holdLength(rope: Rope): void {
  for (let index = 1; index < rope.points.length; index++) {
    const before = rope.points[index - 1].position
    const point = rope.points[index].position
    const dx = point.x - before.x
    const dy = point.y - before.y
    const dz = point.z - before.z
    const length = Math.sqrt(dx * dx + dy * dy + dz * dz)

    if (length < MIN_SEPARATION) {
      continue
    }

    const scale = rope.segmentLength / length
    point.x = before.x + dx * scale
    point.y = before.y + dy * scale
    point.z = before.z + dz * scale
  }
}

function along(point: Vec3, axis: Vec3): number {
  return point.x * axis.x + point.y * axis.y + point.z * axis.z
}

/** Drags and pushes the free points the pointer passes over, on the screen plane. */
function nudgeRope(rope: Rope, nudge: RopeNudge): void {
  const { pointer, right, up, unitsPerPx, frameSeconds } = nudge
  const maxShift = rope.segmentLength * MAX_NUDGE_SEGMENTS

  for (const point of rope.points.slice(1)) {
    const offsetX = (along(point.position, right) - pointer.x) / unitsPerPx
    const offsetY = (along(point.position, up) - pointer.y) / unitsPerPx
    const distancePx = Math.hypot(offsetX, offsetY)
    const influence = stirFalloff(distancePx, 1)

    if (influence <= 0) {
      continue
    }

    const awayX = offsetX / (distancePx + 1)
    const awayY = offsetY / (distancePx + 1)
    const rawRight =
      (pointer.velocityX * POINTER_DRAG + awayX * POINTER_PUSH_SPEED) * frameSeconds * influence
    const rawUp =
      (pointer.velocityY * POINTER_DRAG + awayY * POINTER_PUSH_SPEED) * frameSeconds * influence
    const limit = Math.min(1, maxShift / (Math.hypot(rawRight, rawUp) || 1))
    const shiftRight = rawRight * limit
    const shiftUp = rawUp * limit
    point.position.x += right.x * shiftRight + up.x * shiftUp
    point.position.y += right.y * shiftRight + up.y * shiftUp
    point.position.z += right.z * shiftRight + up.z * shiftUp
  }
}
