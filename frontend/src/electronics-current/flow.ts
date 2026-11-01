// Pure motion rules for the masthead current, in camera-space units: x across
// the screen, y up the screen, z towards the viewer.

export interface Vec3 {
  x: number
  y: number
  z: number
}

export interface FlowBody {
  position: Vec3
  velocity: Vec3
  seed: number
}

/** A pointer expressed in camera-space units and units per second. */
export interface PointerFlow {
  x: number
  y: number
  velocityX: number
  velocityY: number
}

/** Leftward drift speed in units per second (about 18 px/s at the masthead scale). */
export const FLOW_SPEED = 3.2

/** Parts closer than this gently push apart. */
export const SEPARATION_RADIUS = 7.5

/** Pointer reach in CSS pixels. */
export const STIR_RADIUS_PX = 120

const DEPTH_LIMIT = 8

const BOUNDARY_STIFFNESS = 1.5

const FLOW_RELAX_RATE = 0.9

function softLimit(value: number, limit: number): number {
  if (value > limit) {
    return -(value - limit) * BOUNDARY_STIFFNESS
  }

  if (value < -limit) {
    return (-limit - value) * BOUNDARY_STIFFNESS
  }

  return 0
}

/** Velocity the current wants at a position: steady leftward drift with gentle waves. */
export function flowTarget(
  position: Vec3,
  time: number,
  seed: number,
  verticalLimit: number,
): Vec3 {
  const wave =
    Math.sin(position.x * 0.06 + time * 0.35 + seed) * 0.9 +
    Math.sin(position.x * 0.13 - time * 0.2 + seed * 2) * 0.4
  const depthWave = Math.cos(position.x * 0.05 + time * 0.25 + seed) * 0.6

  return {
    x: -FLOW_SPEED * (0.97 + 0.006 * seed),
    y: wave + softLimit(position.y, verticalLimit),
    z: depthWave + softLimit(position.z, DEPTH_LIMIT),
  }
}

/** Ease a velocity towards a target, frame-rate independently. */
export function relaxTowards(velocity: Vec3, target: Vec3, frameSeconds: number): void {
  const blend = 1 - Math.exp(-frameSeconds * FLOW_RELAX_RATE)
  velocity.x += (target.x - velocity.x) * blend
  velocity.y += (target.y - velocity.y) * blend
  velocity.z += (target.z - velocity.z) * blend
}

/** Push overlapping neighbours apart in the screen plane so the flow never clumps. */
export function separate(bodies: FlowBody[], frameSeconds: number): void {
  for (let first = 0; first < bodies.length; first++) {
    for (let second = first + 1; second < bodies.length; second++) {
      const a = bodies[first]
      const b = bodies[second]
      const dx = a.position.x - b.position.x
      const dy = a.position.y - b.position.y
      const distanceSquared = dx * dx + dy * dy

      if (distanceSquared >= SEPARATION_RADIUS * SEPARATION_RADIUS || distanceSquared < 1e-6) {
        continue
      }

      const distance = Math.sqrt(distanceSquared)
      const push = (1 - distance / SEPARATION_RADIUS) * frameSeconds * 3
      const normalX = dx / distance
      const normalY = dy / distance
      a.velocity.x += normalX * push
      a.velocity.y += normalY * push
      b.velocity.x -= normalX * push
      b.velocity.y -= normalY * push
    }
  }
}

/** Pointer influence 0..strength, falling off quadratically to zero at the stir radius. */
export function stirFalloff(distancePx: number, strength: number): number {
  if (distancePx >= STIR_RADIUS_PX) {
    return 0
  }

  const closeness = 1 - distancePx / STIR_RADIUS_PX

  return closeness * closeness * strength
}

/** Drag a body slightly along with the pointer and nudge it aside. */
export function applyStir(
  body: FlowBody,
  pointer: PointerFlow,
  influence: number,
  frameSeconds: number,
  random: () => number,
): void {
  const dx = body.position.x - pointer.x
  const dy = body.position.y - pointer.y
  const distance = Math.hypot(dx, dy) + 0.001
  const drag = Math.min(1, frameSeconds * 5 * influence) * 0.2
  body.velocity.x += (pointer.velocityX - body.velocity.x) * drag
  body.velocity.y += (pointer.velocityY - body.velocity.y) * drag
  body.velocity.x += (dx / distance) * influence * frameSeconds * 3
  body.velocity.y += (dy / distance) * influence * frameSeconds * 3
  body.velocity.z += (random() - 0.5) * influence * frameSeconds * 3
}
