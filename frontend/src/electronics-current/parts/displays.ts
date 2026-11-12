import { Group, Sprite, type Mesh } from 'three'
import { fills } from '#/electronics-current/finishes'
import type { DisplayMaterials, OutlineKit } from '#/electronics-current/outline-kit'
import {
  createPart,
  type DisplayMode,
  type DisplayState,
  type PartBuilder,
  type PartType,
} from '#/electronics-current/part-model'
import { at, box, cylinder, pick } from '#/electronics-current/shapes'

/** Scrolling message on the 14-segment displays (trailing spaces pace the loop). */
export const DISPLAY_MESSAGE = 'BENCH INTAKE   '

// Characters advance every 0.45 s; counters advance every second step.
const STEP_SECONDS = 0.45

const QUARTER_TURN = Math.PI / 2

// [segment, x, y, length, rotation]
type SegmentLayout = readonly [string, number, number, number, number]

const FOURTEEN_SEGMENT_LAYOUT: readonly SegmentLayout[] = [
  ['a', 0, 1.3, 1.2, 0],
  ['d', 0, -1.3, 1.2, 0],
  ['f', -0.75, 0.65, 1.1, QUARTER_TURN],
  ['e', -0.75, -0.65, 1.1, QUARTER_TURN],
  ['b', 0.75, 0.65, 1.1, QUARTER_TURN],
  ['c', 0.75, -0.65, 1.1, QUARTER_TURN],
  ['g1', -0.36, 0, 0.58, 0],
  ['g2', 0.36, 0, 0.58, 0],
  ['vT', 0, 0.65, 1.0, QUARTER_TURN],
  ['vB', 0, -0.65, 1.0, QUARTER_TURN],
  ['dTL', -0.36, 0.65, 0.95, 2.05],
  ['dTR', 0.36, 0.65, 0.95, 1.09],
  ['dBL', -0.36, -0.65, 0.95, 1.09],
  ['dBR', 0.36, -0.65, 0.95, 2.05],
  ['dp', 0.86, -1.3, 0.18, 0],
]

const SEVEN_SEGMENT_LAYOUT: readonly SegmentLayout[] = [
  ['a', 0, 1.3, 1.2, 0],
  ['d', 0, -1.3, 1.2, 0],
  ['f', -0.75, 0.65, 1.1, QUARTER_TURN],
  ['e', -0.75, -0.65, 1.1, QUARTER_TURN],
  ['b', 0.75, 0.65, 1.1, QUARTER_TURN],
  ['c', 0.75, -0.65, 1.1, QUARTER_TURN],
  ['g', 0, 0, 1.2, 0],
  ['dp', 0.98, -1.3, 0.2, 0],
]

const DIGITS_FOURTEEN: Record<string, string> = {
  '0': 'a b c d e f dTR dBL',
  '1': 'b c dTR',
  '2': 'a b d e g1 g2',
  '3': 'a b c d g2',
  '4': 'b c f g1 g2',
  '5': 'a c d f g1 g2',
  '6': 'a c d e f g1 g2',
  '7': 'a b c',
  '8': 'a b c d e f g1 g2',
  '9': 'a b c d f g1 g2',
}

export const FOURTEEN_SEGMENT_FONT: Record<string, string> = {
  ...DIGITS_FOURTEEN,
  A: 'a b c e f g1 g2',
  B: 'a b c d vT vB g2',
  C: 'a d e f',
  E: 'a d e f g1 g2',
  H: 'b c e f g1 g2',
  I: 'a d vT vB',
  K: 'e f g1 dTR dBR',
  N: 'b c e f dTL dBR',
  T: 'a vT vB',
  ' ': '',
}

export const SEVEN_SEGMENT_FONT: Record<string, string> = {
  '0': 'a b c d e f',
  '1': 'b c',
  '2': 'a b d e g',
  '3': 'a b c d g',
  '4': 'b c f g',
  '5': 'a c d f g',
  '6': 'a c d e f g',
  '7': 'a b c',
  '8': 'a b c d e f g',
  '9': 'a b c d f g',
}

// Each digit lights its own stacked numeral.
export const NIXIE_FONT: Record<string, string> = Object.fromEntries(
  Array.from({ length: 10 }, (_, digit) => [String(digit), `n${digit}`]),
)

function positiveModulo(value: number, divisor: number): number {
  return ((value % divisor) + divisor) % divisor
}

/** Characters a display shows at a given animation step. */
export function charactersAt(mode: DisplayMode, step: number): string[] {
  if (mode === 'text') {
    const index = positiveModulo(step, DISPLAY_MESSAGE.length)
    const next = (index + 1) % DISPLAY_MESSAGE.length

    return [DISPLAY_MESSAGE[index], DISPLAY_MESSAGE[next]]
  }

  if (mode === 'count') {
    const count = positiveModulo(Math.floor(step / 2), 100)

    return [String(Math.floor(count / 10)), String(count % 10)]
  }

  return [String(positiveModulo(Math.floor(step / 2), 10))]
}

export function fontFor(mode: DisplayMode): Record<string, string> {
  if (mode === 'seven') {
    return SEVEN_SEGMENT_FONT
  }

  if (mode === 'nixie') {
    return NIXIE_FONT
  }

  return FOURTEEN_SEGMENT_FONT
}

/** Light the segments for the current step; only touches materials when it changes. */
export function updateDisplay(display: DisplayState, time: number, seed: number): void {
  const step = Math.floor(time / STEP_SECONDS + seed * 7)

  if (step === display.step) {
    return
  }

  display.step = step
  const characters = charactersAt(display.mode, step)
  const font = fontFor(display.mode)

  display.digits.forEach((segments, digitIndex) => {
    const lit = new Set((font[characters[digitIndex]] ?? '').split(' '))

    const emphasis = display.emphasis?.[digitIndex]

    segments.forEach((segment, name) => {
      const isLit = lit.has(name)
      const heavier = emphasis?.get(name)
      segment.material = isLit ? display.materials.lit : display.materials.unlit

      if (heavier) {
        heavier.visible = isLit
      }
    })
  })
}

function addDigit(
  kit: OutlineKit,
  group: Group,
  layout: readonly SegmentLayout[],
  materials: DisplayMaterials,
  offsetX: number,
  thickness: number,
): Map<string, Mesh> {
  const segments = new Map<string, Mesh>()

  for (const [name, x, y, length, rotation] of layout) {
    const geometry = box(length, thickness, 0.06).rotateZ(rotation)
    const segment = at(kit.segment(geometry, materials), offsetX + x, y, 0.47)
    group.add(segment)
    segments.set(name, segment)
  }

  return segments
}

function addDisplayGlow(group: Group, materials: DisplayMaterials, width: number): void {
  const glow = new Sprite(materials.glow)
  glow.position.set(0, 0, 0.9)
  glow.scale.set(width, 5.5, 1)
  glow.renderOrder = 3
  group.add(glow)
}

function addDisplayPins(kit: OutlineKit, group: Group, xs: number[]): void {
  for (const x of xs) {
    group.add(at(kit.lead(cylinder(0.06, 1.4, 8)), x, -2.5, 0.25))
    group.add(at(kit.lead(cylinder(0.06, 1.4, 8)), x, -2.5, -0.25))
  }
}

/** Two-digit 14-segment module: scrolls the message or counts 00 to 99. */
const display14: PartBuilder = ({ kit, random }) => {
  const group = new Group()
  const materials = pick(kit.displays, random)
  const mode: DisplayMode = random() < 0.5 ? 'text' : 'count'
  group.add(kit.body(box(3.8, 3.6, 0.9), fills.darkPlastic))
  const digits = [-0.95, 0.95].map((offsetX) =>
    addDigit(kit, group, FOURTEEN_SEGMENT_LAYOUT, materials, offsetX, 0.16),
  )
  addDisplayGlow(group, materials, 6.5)
  addDisplayPins(kit, group, [-1.5, -0.75, 0, 0.75, 1.5])

  return createPart(group, {
    facesViewer: true,
    display: { digits, materials, mode, step: null },
  })
}

/** Single-digit 7-segment display counting 0 to 9. */
const display7: PartBuilder = ({ kit, random }) => {
  const group = new Group()
  const materials = pick(kit.displays, random)
  group.add(kit.body(box(2.4, 3.6, 0.9), fills.darkPlastic))
  const digit = addDigit(kit, group, SEVEN_SEGMENT_LAYOUT, materials, -0.1, 0.22)
  addDisplayGlow(group, materials, 4.5)
  addDisplayPins(kit, group, [-0.8, -0.4, 0, 0.4, 0.8])

  return createPart(group, {
    facesViewer: true,
    display: { digits: [digit], materials, mode: 'seven', step: null },
  })
}

export const displayBuilders = {
  display14,
  display7,
} satisfies Partial<Record<PartType, PartBuilder>>
