import { CapsuleGeometry, CylinderGeometry, Group, SphereGeometry, Sprite } from 'three'
import { fills, LED_COLOURS } from '#/electronics-current/finishes'
import {
  createPart,
  type BuildContext,
  type PartBuilder,
  type PartType,
} from '#/electronics-current/part-model'
import { at, box, cylinder, pick } from '#/electronics-current/shapes'

type LedShape = 'round' | 'small' | 'rectangular'

function buildLed({ kit, random }: BuildContext, shape: LedShape) {
  const group = new Group()
  const led = kit.createLed(pick(LED_COLOURS, random))
  const glow = new Sprite(led.glow)

  if (shape === 'rectangular') {
    group.add(at(kit.ledBody(box(1.9, 1.6, 0.95), led), 0, 0.65, 0))
    group.add(at(kit.ledBody(box(2.1, 0.2, 1.1), led), 0, -0.15, 0))
  } else {
    const dome = new SphereGeometry(0.72, 24, 12, 0, Math.PI * 2, 0, Math.PI / 2)
    group.add(at(kit.ledBody(cylinder(0.72, 1.3, 24), led), 0, 0.5, 0))
    group.add(at(kit.ledBody(dome, led), 0, 1.15, 0))
    group.add(at(kit.ledBody(cylinder(0.86, 0.2, 24), led), 0, -0.15, 0))
  }

  glow.position.set(0, 0.9, 0)
  glow.scale.set(7, 7, 1)
  glow.renderOrder = 3
  group.add(glow)
  group.add(at(kit.lead(cylinder(0.06, 3.0, 8)), -0.32, -1.75, 0))
  group.add(at(kit.lead(cylinder(0.06, 2.4, 8)), 0.32, -1.45, 0))

  return createPart(group, { led, scale: shape === 'small' ? 0.7 : 1 })
}

const led: PartBuilder = (context) => buildLed(context, 'round')

const led3mm: PartBuilder = (context) => buildLed(context, 'small')

const ledRectangular: PartBuilder = (context) => buildLed(context, 'rectangular')

const diode: PartBuilder = ({ kit }) => {
  const group = new Group()
  group.add(kit.body(cylinder(0.42, 1.9, 20), fills.epoxy))
  group.add(at(kit.detail(cylinder(0.43, 0.26, 20), fills.diodeBand), 0, 0.7, 0))
  group.add(at(kit.lead(cylinder(0.07, 2.5, 8)), 0, 2.2, 0))
  group.add(at(kit.lead(cylinder(0.07, 2.5, 8)), 0, -2.2, 0))

  return createPart(group, { layFlat: true })
}

/** 1N4148-style glass diode: slugs and die visible through amber glass. */
const glassDiode: PartBuilder = ({ kit }) => {
  const group = new Group()
  group.add(at(kit.detail(cylinder(0.2, 0.5, 14), fills.slug), 0, -0.45, 0))
  group.add(at(kit.detail(cylinder(0.2, 0.5, 14), fills.slug), 0, 0.45, 0))
  group.add(kit.detail(box(0.18, 0.12, 0.18), fills.marking))
  group.add(kit.glass(new CapsuleGeometry(0.38, 1.2, 6, 18), fills.glass))
  group.add(at(kit.detail(cylinder(0.395, 0.24, 20), fills.glassBand), 0, 0.62, 0))
  group.add(at(kit.lead(cylinder(0.06, 2.5, 8)), 0, 2.15, 0))
  group.add(at(kit.lead(cylinder(0.06, 2.5, 8)), 0, -2.15, 0))

  return createPart(group, { layFlat: true })
}

const powerDiode: PartBuilder = ({ kit }) => {
  const group = new Group()
  group.add(kit.body(cylinder(0.75, 2.6, 24), fills.epoxy))
  group.add(at(kit.detail(cylinder(0.765, 0.35, 24), fills.diodeBand), 0, 0.95, 0))
  group.add(at(kit.lead(cylinder(0.11, 2.6, 10)), 0, 2.6, 0))
  group.add(at(kit.lead(cylinder(0.11, 2.6, 10)), 0, -2.6, 0))

  return createPart(group, { layFlat: true })
}

const bridgeRectifier: PartBuilder = ({ kit }) => {
  const group = new Group()
  group.add(kit.body(box(3.2, 2.6, 1.2), fills.epoxy))
  group.add(at(kit.detail(box(0.4, 0.1, 0.04), fills.marking), -1.1, 0.8, 0.62))
  group.add(at(kit.detail(box(0.1, 0.4, 0.04), fills.marking), -1.1, 0.8, 0.62))

  for (const x of [-1.15, -0.4, 0.4, 1.15]) {
    group.add(at(kit.lead(cylinder(0.07, 2.4, 8)), x, -2.5, 0))
  }

  return createPart(group)
}

const to92: PartBuilder = ({ kit }) => {
  const group = new Group()
  const halfRound = new CylinderGeometry(0.85, 0.85, 1.7, 24, 1, false, 0, Math.PI)
  group.add(at(kit.body(halfRound, fills.epoxy), 0, 1, 0))
  group.add(at(kit.body(box(0.02, 1.7, 1.7), fills.epoxy), 0, 1, 0))

  for (const z of [-0.5, 0, 0.5]) {
    group.add(at(kit.lead(cylinder(0.06, 2.8, 8)), 0.25, -1.25, z))
  }

  return createPart(group)
}

function addTabLegs(context: BuildContext, group: Group, spacing: number, shoulderY: number) {
  const { kit } = context

  for (const x of [-spacing, 0, spacing]) {
    group.add(at(kit.lead(box(0.33, 0.45, 0.09)), x, shoulderY, 0))
    group.add(at(kit.lead(box(0.17, 2.3, 0.07)), x, shoulderY - 1.4, 0))
  }
}

const to126: PartBuilder = (context) => {
  const { kit } = context
  const group = new Group()
  group.add(kit.body(box(2.0, 2.6, 0.7), fills.epoxy))
  group.add(at(kit.detail(cylinder(0.3, 0.72, 18).rotateX(Math.PI / 2), fills.hole), 0, 0.6, 0))
  addTabLegs(context, group, 0.55, -1.5)

  return createPart(group)
}

const to18: PartBuilder = ({ kit }) => {
  const group = new Group()
  group.add(at(kit.body(cylinder(0.7, 1.0, 24), fills.aluminium), 0, 0.6, 0))
  group.add(at(kit.body(cylinder(0.82, 0.15, 24), fills.aluminium), 0, 0.03, 0))
  group.add(at(kit.body(box(0.3, 0.15, 0.3), fills.aluminium), 0.85, 0.03, 0))

  for (const [x, z] of [
    [-0.3, 0],
    [0.3, 0],
    [0, 0.3],
  ]) {
    group.add(at(kit.lead(cylinder(0.05, 2.6, 8)), x, -1.25, z))
  }

  return createPart(group, { scale: 1.2 })
}

/** TO-220 voltage regulator: body, metal tab with mounting hole, three legs. */
const regulator: PartBuilder = (context) => {
  const { kit } = context
  const group = new Group()
  const hole = cylinder(0.32, 0.27, 20).rotateX(Math.PI / 2)
  group.add(kit.body(box(2.0, 1.8, 0.9), fills.epoxy))
  group.add(at(kit.body(box(2.0, 1.7, 0.25), fills.aluminium), 0, 1.75, -0.33))
  group.add(at(kit.detail(hole, fills.hole), 0, 1.95, -0.33))
  addTabLegs(context, group, 0.65, -1.15)

  return createPart(group)
}

export const semiconductorBuilders = {
  led,
  led3mm,
  ledRectangular,
  diode,
  glassDiode,
  powerDiode,
  bridgeRectifier,
  to92,
  to126,
  to18,
  regulator,
} satisfies Partial<Record<PartType, PartBuilder>>
