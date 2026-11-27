import { CapsuleGeometry, Group, LatheGeometry, SphereGeometry, SplineCurve, Vector2 } from 'three'
import { fills, PLASTIC_FILLS, RESISTOR_CODE_FILLS } from '#/electronics-current/finishes'
import {
  createPart,
  type BuildContext,
  type PartBuilder,
  type PartType,
} from '#/electronics-current/part-model'
import {
  at,
  axialLeads,
  bentLead,
  box,
  cylinder,
  leadJoint,
  pick,
  radialLeads,
  sleeveStripe,
} from '#/electronics-current/shapes'

const RESISTOR_HALF_LENGTH = 2.4

/**
 * Carbon-film body: rounded end caps blending into a slim waist, sampled finely so
 * no crease rings or silhouette kinks appear.
 */
export function resistorProfile(): Vector2[] {
  const capLength = 0.45
  const endRadius = 0.92
  const waistRadius = 0.78
  const steps = 48
  const points: Vector2[] = []

  function radiusAt(y: number): number {
    const distance = Math.abs(y)
    const blend = Math.min(1, Math.max(0, (distance - 0.95) / 0.4))
    const smooth = blend * blend * (3 - 2 * blend)
    const radius = waistRadius + (endRadius - waistRadius) * smooth

    if (distance <= RESISTOR_HALF_LENGTH - capLength) {
      return radius
    }

    const cap = Math.min(1, (distance - (RESISTOR_HALF_LENGTH - capLength)) / capLength)

    return radius * Math.sqrt(1 - cap * cap)
  }

  for (let index = 0; index <= steps; index++) {
    const position = (index / steps) * 2 - 1
    const y = RESISTOR_HALF_LENGTH * Math.sign(position) * Math.pow(Math.abs(position), 0.7)
    const isPole = index === 0 || index === steps
    points.push(new Vector2(isPole ? 0 : radiusAt(y), y))
  }

  return points
}

/** Beige carbon film (four bands) or blue metal film (five bands, 1% tolerance). */
function addResistorBody({ kit, random }: BuildContext, group: Group): void {
  const isMetalFilm = random() < 0.45

  const digit = (lowest: number) =>
    RESISTOR_CODE_FILLS[lowest + Math.floor(random() * (10 - lowest))]

  const multiplier = () => RESISTOR_CODE_FILLS[Math.floor(random() * 5)]

  const bodyFill = isMetalFilm ? fills.resistorBlue : fills.resistorBeige
  const tolerance = random() < 0.8 ? fills.gold : fills.silver
  const bands: [number, number, number][] = isMetalFilm
    ? [
        [-1.75, 0.935, digit(1)],
        [-0.7, 0.795, digit(0)],
        [-0.2, 0.795, digit(0)],
        [0.3, 0.795, multiplier()],
        [1.75, 0.935, RESISTOR_CODE_FILLS[1]],
      ]
    : [
        [-1.75, 0.935, digit(1)],
        [-0.6, 0.795, digit(0)],
        [0, 0.795, multiplier()],
        [1.75, 0.935, tolerance],
      ]

  group.add(kit.body(new LatheGeometry(resistorProfile(), 28), bodyFill))

  for (const [y, radius, colour] of bands) {
    group.add(at(kit.detail(cylinder(radius, 0.32, 28), colour), 0, y, 0))
  }
}

const resistor: PartBuilder = (context) => {
  const group = new Group()
  addResistorBody(context, group)
  axialLeads(context.kit, group, 3.6)

  return createPart(group, { layFlat: true })
}

const resistorSmall: PartBuilder = (context) => {
  const group = new Group()
  addResistorBody(context, group)
  axialLeads(context.kit, group, 3.6)

  return createPart(group, { layFlat: true, scale: 0.65 })
}

/** Standing resistor: the top lead loops over and runs back down beside the body. */
const resistorVertical: PartBuilder = (context) => {
  const { kit } = context
  const group = new Group()
  addResistorBody(context, group)
  group.add(bentLead(kit, [0, -2.3], [0, -5.0]))
  group.add(bentLead(kit, [0, 2.3], [0, 3.1]))
  group.add(leadJoint(kit, 0, 3.1))
  group.add(bentLead(kit, [0, 3.1], [0.65, 3.45]))
  group.add(leadJoint(kit, 0.65, 3.45))
  group.add(bentLead(kit, [0.65, 3.45], [1.3, 3.1]))
  group.add(leadJoint(kit, 1.3, 3.1))
  group.add(bentLead(kit, [1.3, 3.1], [1.3, -5.0]))

  return createPart(group)
}

/** 5 W cement power resistor with a printed label. */
const resistorPower: PartBuilder = ({ kit }) => {
  const group = new Group()
  group.add(kit.body(box(1.5, 5.2, 1.5), fills.cement))
  group.add(at(kit.detail(box(1.0, 3.4, 0.04), fills.label), 0, 0, 0.77))
  axialLeads(kit, group, 3.8, 0.1)

  return createPart(group, { layFlat: true })
}

function squashedDisc(radius: number, scaleX: number, scaleY: number, scaleZ: number) {
  return new SphereGeometry(radius, 24, 16).scale(scaleX, scaleY, scaleZ)
}

const ceramicDisc: PartBuilder = ({ kit }) => {
  const group = new Group()
  group.add(at(kit.body(squashedDisc(1.4, 1, 1, 0.42), fills.ceramicDisc), 0, 1.2, 0))
  radialLeads(kit, group, 0.5, 0.2, [3.2, 3.2])

  return createPart(group)
}

/** Blue ceramic: leads leave close together, splay out at an angle, then run parallel. */
const blueCeramic: PartBuilder = ({ kit }) => {
  const group = new Group()
  group.add(at(kit.body(squashedDisc(1.25, 1, 1, 0.45), fills.blueCeramic), 0, 1.05, 0))

  for (const side of [-1, 1]) {
    group.add(bentLead(kit, [side * 0.28, -0.05], [side * 0.85, -0.8], 0.065))
    group.add(leadJoint(kit, side * 0.85, -0.8, 0.065))
    group.add(bentLead(kit, [side * 0.85, -0.8], [side * 0.85, -3.4], 0.065))
  }

  return createPart(group)
}

const monolithic: PartBuilder = ({ kit }) => {
  const group = new Group()
  group.add(at(kit.body(squashedDisc(1.0, 0.95, 0.8, 0.45), fills.monolithic), 0, 0.8, 0))
  radialLeads(kit, group, 0.4, 0, [2.6, 2.6])

  return createPart(group, { scale: 0.85 })
}

const electrolytic: PartBuilder = ({ kit }) => {
  const group = new Group()
  group.add(at(kit.body(cylinder(1.05, 3.2, 28), fills.electrolytic), 0, 0.8, 0))
  group.add(at(kit.detail(sleeveStripe(1.065, 3.0, 0.9), fills.sleeveStripe), 0, 0.8, 0))
  group.add(at(kit.detail(cylinder(0.96, 0.06, 28), fills.aluminium), 0, 2.42, 0))
  radialLeads(kit, group, 0.42, -0.75, [2.4, 2.0])

  return createPart(group)
}

const electrolyticLarge: PartBuilder = ({ kit }) => {
  const group = new Group()
  group.add(at(kit.body(cylinder(1.6, 4.4, 32), fills.darkPlastic), 0, 1.4, 0))
  group.add(at(kit.detail(sleeveStripe(1.615, 4.2, 0.8), fills.brass), 0, 1.4, 0))
  group.add(at(kit.detail(cylinder(1.5, 0.06, 32), fills.aluminium), 0, 3.62, 0))
  radialLeads(kit, group, 0.6, -0.75, [2.4, 2.0])

  return createPart(group, { scale: 0.9 })
}

const electrolyticAxial: PartBuilder = ({ kit }) => {
  const group = new Group()
  group.add(kit.body(cylinder(1.0, 3.6, 28), fills.electrolytic))
  group.add(kit.detail(sleeveStripe(1.015, 3.4, 0.9), fills.sleeveStripe))
  axialLeads(kit, group, 3.0)

  return createPart(group, { layFlat: true })
}

const electrolyticSmd: PartBuilder = ({ kit }) => {
  const group = new Group()
  group.add(kit.body(box(2.4, 0.5, 2.4), fills.darkPlastic))
  group.add(at(kit.body(cylinder(1.0, 2.0, 28), fills.aluminium), 0, 1.25, 0))
  group.add(at(kit.detail(cylinder(0.95, 0.04, 28), fills.marking), 0, 2.27, 0))
  group.add(at(kit.lead(box(0.5, 0.08, 0.8)), -1.35, -0.21, 0))
  group.add(at(kit.lead(box(0.5, 0.08, 0.8)), 1.35, -0.21, 0))

  return createPart(group, { scale: 1.1 })
}

const filmCapacitor: PartBuilder = ({ kit, random }) => {
  const group = new Group()
  const width = pick([2.2, 2.8, 3.4], random)
  group.add(at(kit.body(box(width, 2.0, 1.2), pick(PLASTIC_FILLS, random)), 0, 0.6, 0))
  radialLeads(kit, group, width / 2 - 0.5, -0.4, [2.4, 2.4])

  return createPart(group)
}

/** Dipped tantalum teardrop with a + mark. */
const tantalum: PartBuilder = ({ kit }) => {
  const group = new Group()
  const outline = [
    [0, -1.0],
    [0.55, -0.92],
    [0.8, -0.55],
    [0.86, 0],
    [0.76, 0.5],
    [0.48, 0.92],
    [0.22, 1.12],
    [0, 1.18],
  ].map(([x, y]) => new Vector2(x, y))
  const profile = new SplineCurve(outline).getPoints(32)
  const body = new LatheGeometry(profile, 24).scale(1, 1, 0.62)
  group.add(at(kit.body(body, fills.tantalum), 0, 0.9, 0))
  group.add(at(kit.detail(box(0.5, 0.12, 0.06), fills.tantalumMark), -0.15, 1.35, 0.5))
  group.add(at(kit.detail(box(0.12, 0.5, 0.06), fills.tantalumMark), -0.15, 1.35, 0.5))
  radialLeads(kit, group, 0.32, 0.05, [2.6, 2.6])

  return createPart(group)
}

const crystal: PartBuilder = ({ kit }) => {
  const group = new Group()
  const body = new CapsuleGeometry(0.62, 1.9, 6, 16).rotateZ(Math.PI / 2).scale(1, 1, 0.45)
  group.add(at(kit.body(body, fills.aluminium), 0, 0.8, 0))
  radialLeads(kit, group, 0.9, 0.4, [2.4, 2.4])

  return createPart(group)
}

/** Radial drum inductor: flanged ferrite bobbin with a copper winding. */
const inductor: PartBuilder = ({ kit }) => {
  const group = new Group()
  const bobbin = [
    [0, -1.3],
    [1.1, -1.3],
    [1.1, -1.0],
    [0.6, -1.0],
    [0.6, 1.0],
    [1.1, 1.0],
    [1.1, 1.3],
    [0, 1.3],
  ].map(([x, y]) => new Vector2(x, y))
  group.add(kit.body(new LatheGeometry(bobbin, 28), fills.ferrite))
  group.add(kit.body(cylinder(0.88, 2.0, 28), fills.copper))
  radialLeads(kit, group, 0.4, -1.3, [2.4, 2.4])

  return createPart(group)
}

/** Small PCB transformer: laminated steel core with a taped winding front and back. */
const transformer: PartBuilder = ({ kit }) => {
  const group = new Group()
  group.add(kit.body(box(3.8, 2.8, 1.6), fills.steel))
  group.add(at(kit.body(box(2.2, 2.0, 2.8), fills.tape), 0, -0.1, 0))

  for (const x of [-0.8, 0, 0.8]) {
    for (const z of [-1.1, 1.1]) {
      group.add(at(kit.lead(cylinder(0.08, 1.2, 8)), x, -1.7, z))
    }
  }

  return createPart(group, { scale: 0.9 })
}

export const passiveBuilders = {
  resistor,
  resistorSmall,
  resistorVertical,
  resistorPower,
  ceramicDisc,
  blueCeramic,
  monolithic,
  electrolytic,
  electrolyticLarge,
  electrolyticAxial,
  electrolyticSmd,
  filmCapacitor,
  tantalum,
  crystal,
  inductor,
  transformer,
} satisfies Partial<Record<PartType, PartBuilder>>
