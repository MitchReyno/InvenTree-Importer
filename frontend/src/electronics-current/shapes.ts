import {
  BoxGeometry,
  CylinderGeometry,
  Mesh,
  SphereGeometry,
  type Group,
  type Object3D,
} from 'three'
import type { OutlineKit } from './outline-kit'

export const LEAD_RADIUS = 0.08

export function cylinder(radius: number, height: number, segments = 20): CylinderGeometry {
  return new CylinderGeometry(radius, radius, height, segments)
}

/** Open, partial cylinder used for printed sleeve stripes. */
export function sleeveStripe(radius: number, height: number, arc: number): CylinderGeometry {
  return new CylinderGeometry(radius, radius, height, 16, 1, true, 0, arc)
}

export function box(width: number, height: number, depth: number): BoxGeometry {
  return new BoxGeometry(width, height, depth)
}

export function at<T extends Object3D>(object: T, x: number, y: number, z: number): T {
  object.position.set(x, y, z)

  return object
}

export function pick<T>(items: readonly T[], random: () => number): T {
  return items[Math.floor(random() * items.length)]
}

/** Straight wire segment between two points in the part's XY plane. */
export function bentLead(
  kit: OutlineKit,
  from: [number, number],
  to: [number, number],
  radius = LEAD_RADIUS,
): Mesh {
  const dx = to[0] - from[0]
  const dy = to[1] - from[1]
  const geometry = cylinder(radius, Math.hypot(dx, dy), 8)
  geometry.rotateZ(Math.atan2(dy, dx) - Math.PI / 2)
  geometry.translate((from[0] + to[0]) / 2, (from[1] + to[1]) / 2, 0)

  return kit.lead(geometry)
}

/** Rounded joint that hides the gap where two lead segments meet. */
export function leadJoint(kit: OutlineKit, x: number, y: number, radius = LEAD_RADIUS): Mesh {
  return at(kit.lead(new SphereGeometry(radius, 8, 6)), x, y, 0)
}

/** Two rows of bent DIP legs along a package of `count` pins. */
export function addDipLegs(kit: OutlineKit, group: Group, count: number, halfWidth: number): void {
  const perSide = count / 2

  for (let index = 0; index < perSide; index++) {
    const x = -(perSide - 1) / 2 + index

    for (const side of [-1, 1]) {
      group.add(at(kit.lead(box(0.32, 0.1, 0.35)), x, -0.1, side * (halfWidth + 0.17)))
      group.add(at(kit.lead(box(0.22, 1.1, 0.08)), x, -0.6, side * (halfWidth + 0.33)))
    }
  }
}

export function axialLeads(kit: OutlineKit, group: Group, offset: number, radius = LEAD_RADIUS) {
  group.add(at(kit.lead(cylinder(radius, 2.4, 10)), 0, offset, 0))
  group.add(at(kit.lead(cylinder(radius, 2.4, 10)), 0, -offset, 0))
}

export function radialLeads(
  kit: OutlineKit,
  group: Group,
  spacing: number,
  top: number,
  lengths: [number, number],
) {
  group.add(at(kit.lead(cylinder(0.07, lengths[0], 8)), -spacing, top - lengths[0] / 2, 0))
  group.add(at(kit.lead(cylinder(0.07, lengths[1], 8)), spacing, top - lengths[1] / 2, 0))
}
