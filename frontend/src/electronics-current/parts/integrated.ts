import { Group } from 'three'
import { fills } from '../finishes'
import { createPart, type PartBuilder, type PartType } from '../part-model'
import { addDipLegs, at, box, cylinder, pick } from '../shapes'

const NARROW_DIP_HALF_WIDTH = 0.95

const WIDE_DIP_HALF_WIDTH = 1.9

/** DIP-8, -14, -16 (300 mil) or DIP-24 (600 mil wide body). */
const dip: PartBuilder = ({ kit, random }) => {
  const group = new Group()
  const pins = pick([8, 8, 14, 16, 24], random)
  const length = pins / 2
  const halfWidth = pins === 24 ? WIDE_DIP_HALF_WIDTH : NARROW_DIP_HALF_WIDTH
  const pinOneDot = cylinder(0.16, 0.03, 16)
  group.add(kit.body(box(length, 0.9, halfWidth * 2), fills.epoxy))
  group.add(at(kit.detail(pinOneDot, fills.marking), -length / 2 + 0.5, 0.46, halfWidth - 0.45))
  addDipLegs(kit, group, pins, halfWidth)

  return createPart(group, { scale: pins >= 16 ? 0.85 : 1 })
}

/** 28-pin wide ceramic DIP with a quartz window over the die; sometimes labelled. */
const eprom: PartBuilder = ({ kit, random }) => {
  const group = new Group()
  const length = 14
  const halfWidth = WIDE_DIP_HALF_WIDTH
  const pinOneDot = cylinder(0.18, 0.03, 16)
  group.add(kit.body(box(length, 1.0, halfWidth * 2), fills.ceramicPackage))
  group.add(at(kit.detail(box(0.9, 0.04, 0.9), fills.brass), 0, 0.5, 0))
  group.add(at(kit.glass(cylinder(1.0, 0.12, 28), fills.glass), 0, 0.53, 0))

  if (random() < 0.4) {
    group.add(at(kit.detail(box(3.4, 0.04, 2.6), fills.label), 0, 0.61, 0))
  }

  group.add(at(kit.detail(pinOneDot, fills.marking), -length / 2 + 0.6, 0.51, halfWidth - 0.5))
  addDipLegs(kit, group, 28, halfWidth)

  return createPart(group, { scale: 0.7 })
}

/** SOIC-8, -14 or -16 with gull-wing leads. */
const soic: PartBuilder = ({ kit, random }) => {
  const group = new Group()
  const perSide = pick([8, 14, 16], random) / 2
  const pitch = 0.5
  const length = perSide * pitch + 0.3
  const halfWidth = 0.78
  const pinOneDot = cylinder(0.1, 0.03, 12)
  group.add(kit.body(box(length, 0.6, halfWidth * 2), fills.epoxy))
  group.add(at(kit.detail(pinOneDot, fills.marking), -length / 2 + 0.3, 0.31, halfWidth - 0.3))

  for (let index = 0; index < perSide; index++) {
    const x = -((perSide - 1) / 2) * pitch + index * pitch

    for (const side of [-1, 1]) {
      group.add(at(kit.lead(box(0.14, 0.06, 0.3)), x, 0, side * (halfWidth + 0.15)))
      group.add(at(kit.lead(box(0.14, 0.32, 0.06)), x, -0.14, side * (halfWidth + 0.3)))
      group.add(at(kit.lead(box(0.14, 0.06, 0.3)), x, -0.28, side * (halfWidth + 0.45)))
    }
  }

  return createPart(group, { scale: 1.5 })
}

const sot23: PartBuilder = ({ kit }) => {
  const group = new Group()
  group.add(kit.body(box(1.3, 0.5, 0.7), fills.epoxy))

  for (const [x, side] of [
    [-0.45, 1],
    [0.45, 1],
    [0, -1],
  ]) {
    group.add(at(kit.lead(box(0.16, 0.06, 0.25)), x, -0.05, side * 0.47))
    group.add(at(kit.lead(box(0.16, 0.25, 0.06)), x, -0.15, side * 0.6))
    group.add(at(kit.lead(box(0.16, 0.06, 0.25)), x, -0.25, side * 0.72))
  }

  return createPart(group, { scale: 2.2 })
}

const qfp: PartBuilder = ({ kit }) => {
  const group = new Group()
  group.add(kit.body(box(3, 0.45, 3), fills.epoxy))
  group.add(at(kit.detail(cylinder(0.18, 0.03, 16), fills.marking), -1.05, 0.24, -1.05))

  for (let index = 0; index < 7; index++) {
    const offset = -1.2 + index * 0.4
    group.add(at(kit.lead(box(0.12, 0.08, 0.5)), offset, -0.12, 1.7))
    group.add(at(kit.lead(box(0.12, 0.08, 0.5)), offset, -0.12, -1.7))
    group.add(at(kit.lead(box(0.5, 0.08, 0.12)), 1.7, -0.12, offset))
    group.add(at(kit.lead(box(0.5, 0.08, 0.12)), -1.7, -0.12, offset))
  }

  return createPart(group)
}

const smdChip: PartBuilder = ({ kit }) => {
  const group = new Group()
  group.add(kit.body(box(1.6, 0.55, 0.8), fills.epoxy))
  group.add(at(kit.lead(box(0.3, 0.57, 0.82)), -0.66, 0, 0))
  group.add(at(kit.lead(box(0.3, 0.57, 0.82)), 0.66, 0, 0))

  return createPart(group, { scale: 1.6 })
}

export const integratedBuilders = {
  dip,
  eprom,
  soic,
  sot23,
  qfp,
  smdChip,
} satisfies Partial<Record<PartType, PartBuilder>>
