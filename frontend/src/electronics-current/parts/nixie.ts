import {
  CatmullRomCurve3,
  CurvePath,
  Group,
  LatheGeometry,
  LineCurve3,
  Mesh,
  SplineCurve,
  Sprite,
  TubeGeometry,
  Vector2,
  Vector3,
  type BufferGeometry,
  type Curve,
} from 'three'
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js'
import { CLEAR_GLASS_OPACITY, fills, INNER_GLOW_RENDER_ORDER } from '#/electronics-current/finishes'
import { createPart, type PartBuilder, type PartType } from '#/electronics-current/part-model'
import { at, box, pinRing } from '#/electronics-current/shapes'

type Point = readonly [number, number]

interface Stroke {
  points: readonly Point[]
  /** Smooth strokes follow a curve through their points; others are straight segments. */
  smooth: boolean
  closed: boolean
}

// Numerals are drawn about 1 unit wide and 1.4 tall, then scaled into the tube.
const NUMERAL_SCALE = 1.3

const NUMERAL_CENTRE_Y = 1.95

const THIN_WIRE_RADIUS = 0.035

// The lit numeral is drawn heavier so it reads through the cathodes in front of it.
const LIT_WIRE_RADIUS = 0.09

// Real tubes stack the cathodes front to back in a fixed order, not 0 to 9.
const STACK_ORDER = [1, 6, 2, 7, 5, 0, 4, 9, 8, 3] as const

const STACK_BACK_Z = -0.22

const STACK_SPACING = 0.05

// Lit numerals draw after the unlit cathodes (0) and before the glass (1).
const LIT_RENDER_ORDER = 0.5

function ellipse(radiusX: number, radiusY: number, count: number, centreY = 0): Point[] {
  return Array.from({ length: count }, (_, index) => {
    const angle = (index / count) * Math.PI * 2

    return [Math.sin(angle) * radiusX, Math.cos(angle) * radiusY + centreY] as const
  })
}

const SIX: readonly Point[] = [
  [0.35, 0.6],
  [0.1, 0.72],
  [-0.2, 0.65],
  [-0.4, 0.3],
  [-0.42, -0.3],
  [-0.25, -0.65],
  [0.05, -0.72],
  [0.35, -0.55],
  [0.4, -0.25],
  [0.25, 0],
  [0, 0.05],
  [-0.3, -0.05],
  [-0.42, -0.3],
]

const NUMERALS: Record<number, readonly Stroke[]> = {
  0: [{ points: ellipse(0.42, 0.7, 16), smooth: true, closed: true }],
  1: [
    {
      points: [
        [0, -0.7],
        [0, 0.7],
        [-0.22, 0.48],
      ],
      smooth: false,
      closed: false,
    },
  ],
  2: [
    {
      points: [
        [-0.4, 0.38],
        [-0.28, 0.62],
        [0, 0.71],
        [0.28, 0.62],
        [0.4, 0.36],
        [0.28, 0.04],
        [-0.42, -0.7],
      ],
      smooth: true,
      closed: false,
    },
    {
      points: [
        [-0.42, -0.7],
        [0.42, -0.7],
      ],
      smooth: false,
      closed: false,
    },
  ],
  3: [
    {
      points: [
        [-0.4, 0.55],
        [-0.15, 0.7],
        [0.2, 0.68],
        [0.4, 0.45],
        [0.25, 0.1],
        [-0.05, 0],
        [0.25, -0.08],
        [0.42, -0.35],
        [0.3, -0.62],
        [0, -0.72],
        [-0.3, -0.65],
        [-0.42, -0.5],
      ],
      smooth: true,
      closed: false,
    },
  ],
  4: [
    {
      points: [
        [0.2, -0.7],
        [0.2, 0.7],
        [-0.42, -0.25],
        [0.45, -0.25],
      ],
      smooth: false,
      closed: false,
    },
  ],
  5: [
    {
      points: [
        [0.4, 0.7],
        [-0.35, 0.7],
        [-0.4, 0.1],
      ],
      smooth: false,
      closed: false,
    },
    {
      points: [
        [-0.4, 0.1],
        [0, 0.2],
        [0.35, 0.05],
        [0.42, -0.3],
        [0.3, -0.6],
        [0, -0.72],
        [-0.3, -0.65],
        [-0.42, -0.5],
      ],
      smooth: true,
      closed: false,
    },
  ],
  6: [{ points: SIX, smooth: true, closed: false }],
  7: [
    {
      points: [
        [-0.42, 0.7],
        [0.42, 0.7],
        [-0.05, -0.7],
      ],
      smooth: false,
      closed: false,
    },
  ],
  8: [
    { points: ellipse(0.33, 0.33, 12, 0.38), smooth: true, closed: true },
    { points: ellipse(0.41, 0.38, 14, -0.33), smooth: true, closed: true },
  ],
  9: [{ points: SIX.map(([x, y]) => [-x, -y] as const), smooth: true, closed: false }],
}

// IN-14 style envelope: a straight tube with a rounded top.
const ENVELOPE: readonly Point[] = [
  [0, 0],
  [0.85, 0],
  [0.92, 0.3],
  [0.92, 3.4],
  [0.78, 3.8],
  [0.32, 3.96],
  [0, 4.0],
]

function strokeCurve(stroke: Stroke): Curve<Vector3> {
  const points = stroke.points.map(([x, y]) => new Vector3(x * NUMERAL_SCALE, y * NUMERAL_SCALE, 0))

  if (stroke.smooth) {
    return new CatmullRomCurve3(points, stroke.closed, 'centripetal')
  }

  const path = new CurvePath<Vector3>()

  for (let index = 0; index < points.length - 1; index++) {
    path.add(new LineCurve3(points[index], points[index + 1]))
  }

  return path
}

/** One mesh-ready geometry for a numeral: its strokes as wire tubes, merged. */
function numeralGeometry(strokes: readonly Stroke[], wireRadius: number): BufferGeometry {
  const wires = strokes.map(
    (stroke) =>
      new TubeGeometry(strokeCurve(stroke), stroke.smooth ? 72 : 24, wireRadius, 5, false),
  )
  const merged = mergeGeometries(wires)
  wires.forEach((wire) => wire.dispose())

  if (!merged) {
    throw new Error('Nixie numeral strokes could not be merged')
  }

  return merged
}

/** IN-14 style Nixie: stacked wire numerals counting 0 to 9, the lit one heavier. */
const nixieTube: PartBuilder = ({ kit }) => {
  const group = new Group()
  const materials = kit.nixie
  const numerals = new Map<string, Mesh>()
  const emphasis = new Map<string, Mesh>()
  const envelope = new SplineCurve(ENVELOPE.map(([x, y]) => new Vector2(x, y))).getPoints(32)

  STACK_ORDER.forEach((digit, depth) => {
    const name = `n${digit}`
    const z = STACK_BACK_Z + depth * STACK_SPACING
    const thin = kit.segment(numeralGeometry(NUMERALS[digit], THIN_WIRE_RADIUS), materials)
    const heavy = new Mesh(numeralGeometry(NUMERALS[digit], LIT_WIRE_RADIUS), materials.lit)
    heavy.visible = false
    heavy.renderOrder = LIT_RENDER_ORDER
    group.add(at(thin, 0, NUMERAL_CENTRE_Y, z), at(heavy, 0, NUMERAL_CENTRE_Y, z))
    numerals.set(name, thin)
    emphasis.set(name, heavy)
  })

  const glow = new Sprite(materials.glow)
  glow.position.set(0, NUMERAL_CENTRE_Y, 0.4)
  glow.scale.set(3.4, 4.0, 1)
  glow.renderOrder = INNER_GLOW_RENDER_ORDER
  group.add(glow)
  group.add(at(kit.body(box(1.3, 2.2, 0.04), fills.steel), 0, NUMERAL_CENTRE_Y, -0.38))
  group.add(kit.glass(new LatheGeometry(envelope, 28), fills.tubeGlass, CLEAR_GLASS_OPACITY))
  pinRing(kit, group, 12, 0.55, 0.035, 1.4)

  return createPart(group, {
    facesViewer: true,
    display: { digits: [numerals], emphasis: [emphasis], materials, mode: 'nixie', step: null },
  })
}

export const nixieBuilders = {
  nixieTube,
} satisfies Partial<Record<PartType, PartBuilder>>
