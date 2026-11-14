import { CylinderGeometry, Group, type Mesh } from 'three'
import { fills, PLASTIC_FILLS } from '#/electronics-current/finishes'
import { createPart, type PartBuilder, type PartType } from '#/electronics-current/part-model'
import { addDipLegs, at, box, cylinder, pick } from '#/electronics-current/shapes'

// A pointer sweep counts as a flick when it is fast and close enough.
const FLICK_MIN_SPEED_PX = 150

const FLICK_MIN_INFLUENCE = 0.25

export interface Spring {
  value: number
  velocity: number
}

/** Damped spring step (semi-implicit Euler), stable at the frame times used here. */
export function stepSpring(
  spring: Spring,
  target: number,
  stiffness: number,
  damping: number,
  frameSeconds: number,
): void {
  spring.velocity +=
    ((target - spring.value) * stiffness - spring.velocity * damping) * frameSeconds
  spring.value += spring.velocity * frameSeconds
}

export function isFlick(influence: number, pointerSpeed: number): boolean {
  return pointerSpeed > FLICK_MIN_SPEED_PX && influence > FLICK_MIN_INFLUENCE
}

const trimpot: PartBuilder = ({ kit }) => {
  const group = new Group()
  group.add(kit.body(box(2.4, 1.0, 2.4), fills.trimmerBody))
  group.add(at(kit.detail(cylinder(0.75, 0.18, 24), fills.rotor), 0, 0.59, 0))
  group.add(at(kit.detail(box(1.1, 0.06, 0.18), fills.marking), 0, 0.71, 0))

  for (const x of [-0.9, 0, 0.9]) {
    group.add(at(kit.lead(cylinder(0.07, 1.6, 8)), x, -1.3, x === 0 ? -0.7 : 0.7))
  }

  return createPart(group)
}

/** Tall multi-turn trimpot (3296W style) with a brass adjustment screw. */
const trimpotVertical: PartBuilder = ({ kit }) => {
  const group = new Group()
  group.add(kit.body(box(2.4, 2.6, 1.2), fills.trimmerBody))
  group.add(at(kit.detail(cylinder(0.24, 0.3, 16), fills.brass), 0.8, 1.45, 0))
  group.add(at(kit.detail(box(0.38, 0.06, 0.08), fills.marking), 0.8, 1.62, 0))

  for (const x of [-0.9, 0, 0.9]) {
    group.add(at(kit.lead(cylinder(0.065, 1.6, 8)), x, -2.1, 0))
  }

  return createPart(group)
}

/** Rotary pot whose slotted shaft sweeps slowly back and forth. */
const potentiometer: PartBuilder = ({ kit }) => {
  const group = new Group()
  const shaft = new Group()
  group.add(kit.body(cylinder(1.6, 0.9, 32).rotateX(Math.PI / 2), fills.aluminium))
  group.add(at(kit.body(cylinder(0.45, 0.7, 20).rotateX(Math.PI / 2), fills.aluminium), 0, 0, 0.8))
  shaft.position.set(0, 0, 1.15)
  shaft.add(at(kit.body(cylinder(0.3, 1.4, 20).rotateX(Math.PI / 2), fills.darkPlastic), 0, 0, 0.7))
  shaft.add(at(kit.detail(box(0.5, 0.08, 0.06), fills.marking), 0, 0, 1.42))
  group.add(shaft)

  for (const x of [-0.8, 0, 0.8]) {
    group.add(at(kit.lead(box(0.3, 1.0, 0.08)), x, -2.0, 0))
  }

  return createPart(group, {
    animate: (time, _frameSeconds, seed) => {
      shaft.rotation.z = Math.sin(time * 0.45 + seed) * 2.4
    },
  })
}

/** Tactile button whose plunger is pressed by a pointer flick and bounces back. */
const tactileButton: PartBuilder = ({ kit, random }) => {
  const group = new Group()
  const capColours = [fills.darkPlastic, PLASTIC_FILLS[0], PLASTIC_FILLS[1], PLASTIC_FILLS[3]]
  const plunger: Mesh = at(kit.body(cylinder(0.7, 0.6, 24), pick(capColours, random)), 0, 0.88, 0)
  const travel: Spring = { value: 0, velocity: 0 }
  let readyAt = 0
  group.add(kit.body(box(2.4, 1.0, 2.4), fills.darkPlastic))
  group.add(at(kit.detail(box(2.2, 0.08, 2.2), fills.aluminium), 0, 0.54, 0))
  group.add(plunger)

  for (const x of [-1, 1]) {
    for (const z of [-1, 1]) {
      group.add(at(kit.lead(box(0.3, 0.1, 0.12)), x * 1.3, -0.2, z * 0.75))
      group.add(at(kit.lead(box(0.1, 1.0, 0.12)), x * 1.42, -0.7, z * 0.75))
    }
  }

  return createPart(group, {
    animate: (_time, frameSeconds) => {
      stepSpring(travel, 0, 120, 6, frameSeconds)
      travel.value = Math.max(-0.3, travel.value)
      plunger.position.y = 0.88 + travel.value
    },
    react: (influence, pointerSpeed, time) => {
      if (time > readyAt && isFlick(influence, pointerSpeed)) {
        travel.velocity -= 3.5
        readyAt = time + 0.5
      }
    },
  })
}

/** Toggle switch: the lever snaps over on a pointer flick and occasionally by itself. */
const toggleSwitch: PartBuilder = ({ kit, random }) => {
  const group = new Group()
  const lever = new Group()
  const nut = new CylinderGeometry(0.6, 0.6, 0.16, 6)
  const leverShape = new CylinderGeometry(0.09, 0.15, 1.7, 14).translate(0, 0.85, 0)
  let target = random() < 0.5 ? 0.42 : -0.42
  const angle: Spring = { value: target, velocity: 0 }
  let lastFlipStep: number | null = null
  let readyAt = 0
  group.add(kit.body(box(1.6, 1.4, 1.2), fills.darkPlastic))
  group.add(at(kit.body(cylinder(0.42, 0.7, 20), fills.aluminium), 0, 1.05, 0))
  group.add(at(kit.detail(nut, fills.aluminium), 0, 0.85, 0))
  lever.position.set(0, 1.35, 0)
  lever.add(kit.body(leverShape, fills.aluminium))
  group.add(lever)

  for (const x of [-0.45, 0, 0.45]) {
    group.add(at(kit.lead(box(0.18, 1.2, 0.06)), x, -1.3, 0))
  }

  return createPart(group, {
    animate: (time, frameSeconds, seed) => {
      const flipStep = Math.floor(time / 4 + seed * 5)

      if (lastFlipStep !== null && flipStep !== lastFlipStep) {
        target = -target
      }

      lastFlipStep = flipStep
      stepSpring(angle, target, 160, 9, frameSeconds)
      lever.rotation.z = angle.value
    },
    react: (influence, pointerSpeed, time) => {
      if (time > readyAt && isFlick(influence, pointerSpeed)) {
        target = -target
        readyAt = time + 0.6
      }
    },
  })
}

/** DIP switch bank: sliders flip occasionally and when the pointer flicks past. */
const dipSwitch: PartBuilder = ({ kit, random }) => {
  const group = new Group()
  const positions = pick([4, 8], random)
  const bodyColour = pick([PLASTIC_FILLS[0], PLASTIC_FILLS[3]], random)
  const sliders: Mesh[] = []
  const switchedOn: boolean[] = []
  let lastStep: number | null = null
  let readyAt = 0
  group.add(kit.body(box(positions, 0.9, 1.9), bodyColour))

  for (let index = 0; index < positions; index++) {
    const x = -(positions - 1) / 2 + index
    const on = random() < 0.5
    const slider = at(kit.body(box(0.42, 0.22, 0.45), fills.slider), x, 0.58, on ? -0.3 : 0.3)
    group.add(at(kit.detail(box(0.55, 0.04, 1.2), fills.marking), x, 0.47, 0))
    group.add(slider)
    sliders.push(slider)
    switchedOn.push(on)
  }

  addDipLegs(kit, group, positions * 2, 0.95)

  function flip(index: number): void {
    switchedOn[index] = !switchedOn[index]
  }

  return createPart(group, {
    scale: positions === 8 ? 0.85 : 1,
    animate: (time, frameSeconds, seed) => {
      const step = Math.floor(time / 1.4 + seed * 3)

      if (lastStep !== null && step !== lastStep) {
        const hashed = Math.abs(Math.floor(Math.sin(step * 12.9898 + seed * 78.233) * 43758.5453))
        flip(hashed % positions)
      }

      lastStep = step
      sliders.forEach((slider, index) => {
        const targetZ = switchedOn[index] ? -0.3 : 0.3
        slider.position.z += (targetZ - slider.position.z) * Math.min(1, frameSeconds * 18)
      })
    },
    react: (influence, pointerSpeed, time) => {
      if (time <= readyAt || !isFlick(influence, pointerSpeed)) {
        return
      }

      const index = Math.floor(random() * positions)
      flip(index)

      if (random() < 0.5) {
        flip((index + 1) % positions)
      }

      readyAt = time + 0.35
    },
  })
}

/** Male or female header strip, one or two rows. */
const pinHeader: PartBuilder = ({ kit, random }) => {
  const group = new Group()
  const pinCount = 4 + Math.floor(random() * 5)
  const rows = random() < 0.35 ? 2 : 1
  const isFemale = random() < 0.4

  for (let index = 0; index < pinCount; index++) {
    for (let row = 0; row < rows; row++) {
      const x = -(pinCount - 1) / 2 + index
      const z = -(rows - 1) / 2 + row

      if (isFemale) {
        group.add(at(kit.detail(box(0.36, 0.04, 0.36), fills.marking), x, 2.12, z))
        group.add(at(kit.lead(box(0.2, 1.4, 0.2)), x, -1.2, z))
      } else {
        group.add(at(kit.lead(box(0.25, 4.0, 0.25)), x, 0.4, z))
      }
    }
  }

  const plasticHeight = isFemale ? 2.6 : 1.0
  const plastic = box(pinCount, plasticHeight, rows)
  group.add(at(kit.body(plastic, fills.darkPlastic), 0, isFemale ? 0.8 : 0, 0))

  return createPart(group, { scale: pinCount >= 7 ? 0.85 : 1 })
}

const relay: PartBuilder = ({ kit, random }) => {
  const group = new Group()
  const casing = random() < 0.6 ? PLASTIC_FILLS[3] : fills.darkPlastic
  group.add(kit.body(box(3.8, 3.0, 3.0), casing))
  group.add(at(kit.detail(box(2.6, 0.04, 1.9), fills.label), 0, 1.52, 0))

  for (const [x, z] of [
    [-1.4, -0.9],
    [-1.4, 0.9],
    [1.4, -0.9],
    [1.4, 0.9],
    [0.5, 0],
  ]) {
    group.add(at(kit.lead(box(0.2, 1.2, 0.08)), x, -2.1, z))
  }

  return createPart(group, { scale: 0.9 })
}

export const electromechanicalBuilders = {
  trimpot,
  trimpotVertical,
  potentiometer,
  tactileButton,
  toggleSwitch,
  dipSwitch,
  pinHeader,
  relay,
} satisfies Partial<Record<PartType, PartBuilder>>
