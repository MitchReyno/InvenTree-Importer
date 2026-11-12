import {
  BackSide,
  BufferAttribute,
  Color,
  DataTexture,
  DoubleSide,
  LinearFilter,
  EdgesGeometry,
  LineBasicMaterial,
  LineSegments,
  Mesh,
  MeshBasicMaterial,
  RGBAFormat,
  SpriteMaterial,
  type BufferGeometry,
  type Material,
} from 'three'
import {
  DISPLAY_COLOURS,
  FINISHES,
  fillFor,
  fills,
  HEATER_GLOW,
  NIXIE_GLOW,
  UNLIT_SEGMENT,
  type Finish,
  type ThemeId,
} from './finishes'

// Draw order for parts seen through glass. Unlit parts draw first (0); a lit Nixie numeral
// next, so unlit cathodes never hide it; glows inside glass after that; then the glass and
// its silhouette, which write depth.
export const LIT_NUMERAL_RENDER_ORDER = 0.5

export const INNER_GLOW_RENDER_ORDER = 0.75

export const GLASS_RENDER_ORDER = 1

export const GLASS_SILHOUETTE_RENDER_ORDER = 2

// Silhouette shell thickness in part units: about 1 px for a full-size part. It
// scales with each part's size, so smaller parts get slightly finer outlines.
const HULL_THICKNESS = 0.16

// Edges sharper than this become faint crease lines.
const CREASE_ANGLE_DEGREES = 30

const GLOW_TEXTURE_SIZE = 64

export interface LedMaterials {
  colour: Color
  fill: MeshBasicMaterial
  hull: MeshBasicMaterial
  crease: LineBasicMaterial
  glow: SpriteMaterial
  dispose: () => void
}

export interface DisplayMaterials {
  lit: MeshBasicMaterial
  unlit: MeshBasicMaterial
  glow: SpriteMaterial
}

/** The solder wick's loose end: a flat copper strip and its outline. */
export interface RibbonMaterials {
  fill: MeshBasicMaterial
  edge: LineBasicMaterial
}

export interface OutlineKit {
  /** Filled part surface with a dark silhouette and faint crease lines. */
  body: (geometry: BufferGeometry, fill: number) => Mesh
  /** Surface detail (bands, marks, labels): fill and crease lines, no silhouette. */
  detail: (geometry: BufferGeometry, fill: number) => Mesh
  /** Thin wire or pin drawn as a solid stroke. */
  lead: (geometry: BufferGeometry) => Mesh
  /** Translucent glass whose silhouette draws after it, so its far side never shows. */
  glass: (geometry: BufferGeometry, fill: number, opacity?: number) => Mesh
  createLed: (colour: number) => LedMaterials
  ledBody: (geometry: BufferGeometry, led: LedMaterials) => Mesh
  /** Display segment: plain fill, switched between lit and unlit by the display. */
  segment: (geometry: BufferGeometry, materials: DisplayMaterials) => Mesh
  displays: DisplayMaterials[]
  /** Nixie cathodes: unlit ones are faint and never hide the lit numeral. */
  nixie: DisplayMaterials
  /** Shared warm glow for vacuum tube heaters. */
  tubeGlow: SpriteMaterial
  ribbon: RibbonMaterials
  glowTexture: DataTexture
  /** The current theme's part base; LED pulses start from it. */
  baseFill: Color
  /** Re-tints every material in place for the theme; geometry is untouched. */
  setTheme: (theme: ThemeId) => void
  dispose: () => void
}

type Tint = (finish: Finish, theme: ThemeId) => Color | number

type Tinted = { color: Color }

/**
 * Average normals across coincident vertices so the outline shell stays closed at
 * hard edges (box corners, cylinder rims) instead of tearing into slivers.
 */
export function createHullGeometry(geometry: BufferGeometry): BufferGeometry {
  const hull = geometry.clone()
  const positions = hull.getAttribute('position')
  const normals = hull.getAttribute('normal')
  const sums = new Map<string, [number, number, number]>()
  const keys: string[] = []

  for (let index = 0; index < positions.count; index++) {
    const key = [positions.getX(index), positions.getY(index), positions.getZ(index)]
      .map((value) => Math.round(value * 1000))
      .join(',')
    const sum = sums.get(key) ?? [0, 0, 0]
    sum[0] += normals.getX(index)
    sum[1] += normals.getY(index)
    sum[2] += normals.getZ(index)
    sums.set(key, sum)
    keys.push(key)
  }

  const smoothNormals = new Float32Array(positions.count * 3)

  keys.forEach((key, index) => {
    const sum = sums.get(key) ?? [0, 0, 1]
    const length = Math.hypot(sum[0], sum[1], sum[2]) || 1
    smoothNormals[index * 3] = sum[0] / length
    smoothNormals[index * 3 + 1] = sum[1] / length
    smoothNormals[index * 3 + 2] = sum[2] / length
  })
  hull.setAttribute('smoothNormal', new BufferAttribute(smoothNormals, 3))

  return hull
}

function createHullMaterial(colour: number | Color): MeshBasicMaterial {
  const material = new MeshBasicMaterial({ color: colour, side: BackSide })

  material.onBeforeCompile = (shader) => {
    shader.vertexShader =
      'attribute vec3 smoothNormal;\n' +
      shader.vertexShader.replace(
        '#include <begin_vertex>',
        `vec3 transformed = vec3(position) + smoothNormal * ${HULL_THICKNESS.toFixed(2)};`,
      )
  }

  return material
}

function createFillMaterial(colour: number | Color): MeshBasicMaterial {
  return new MeshBasicMaterial({
    color: colour,
    polygonOffset: true,
    polygonOffsetFactor: 1,
    polygonOffsetUnits: 1,
  })
}

/** Soft radial falloff used for LED and display glows. */
export function createGlowTexture(): DataTexture {
  const size = GLOW_TEXTURE_SIZE
  const data = new Uint8Array(size * size * 4)

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const distance = Math.hypot(x - size / 2 + 0.5, y - size / 2 + 0.5) / (size / 2)
      const radius = Math.min(1, distance)
      const offset = (y * size + x) * 4
      data[offset] = 255
      data[offset + 1] = 255
      data[offset + 2] = 255
      data[offset + 3] = Math.round(255 * Math.pow(1 - radius, 2.2))
    }
  }

  const texture = new DataTexture(data, size, size, RGBAFormat)
  // DataTexture defaults to nearest filtering, which makes stretched glows blocky.
  texture.magFilter = LinearFilter
  texture.minFilter = LinearFilter
  texture.needsUpdate = true

  return texture
}

const outline: Tint = (finish) => finish.outline

const creaseTint: Tint = (finish) => finish.crease

const base: Tint = (finish) => finish.base

function partFill(light: number): Tint {
  return (_finish, theme) => fillFor(light, theme)
}

export function createOutlineKit(initialTheme: ThemeId = 'light'): OutlineKit {
  let theme = initialTheme
  const tints = new Map<Tinted, Tint>()
  const baseFill = new Color(FINISHES[theme].base)

  /** Colours a material for the current theme and keeps it in step with later changes. */
  function tinted<T extends Tinted>(material: T, tint: Tint): T {
    tints.set(material, tint)
    material.color.set(tint(FINISHES[theme], theme))

    return material
  }

  const owned: Material[] = []
  const fillsByColour = new Map<number, MeshBasicMaterial>()
  const glassByFinish = new Map<string, MeshBasicMaterial>()
  const hull = tinted(createHullMaterial(FINISHES.light.outline), outline)
  const glassHull = tinted(createHullMaterial(FINISHES.light.outline), outline)
  const crease = tinted(new LineBasicMaterial(), creaseTint)
  const solid = tinted(new MeshBasicMaterial(), outline)
  const glowTexture = createGlowTexture()
  const unlit = tinted(new MeshBasicMaterial(), partFill(UNLIT_SEGMENT))

  glassHull.transparent = true
  owned.push(hull, glassHull, crease, solid, unlit)

  function fill(colour: number): MeshBasicMaterial {
    const cached = fillsByColour.get(colour)

    if (cached) {
      return cached
    }

    const material = tinted(createFillMaterial(colour), partFill(colour))
    fillsByColour.set(colour, material)
    owned.push(material)

    return material
  }

  function addCreases(mesh: Mesh, material: LineBasicMaterial): void {
    mesh.add(new LineSegments(new EdgesGeometry(mesh.geometry, CREASE_ANGLE_DEGREES), material))
  }

  function body(geometry: BufferGeometry, colour: number): Mesh {
    const mesh = new Mesh(geometry, fill(colour))
    mesh.add(new Mesh(createHullGeometry(geometry), hull))
    addCreases(mesh, crease)

    return mesh
  }

  function detail(geometry: BufferGeometry, colour: number): Mesh {
    const mesh = new Mesh(geometry, fill(colour))
    addCreases(mesh, crease)

    return mesh
  }

  function lead(geometry: BufferGeometry): Mesh {
    return new Mesh(geometry, solid)
  }

  // Shared per colour and opacity like fills, so recycled glass parts never accumulate materials.
  function glassMaterial(colour: number, opacity: number): MeshBasicMaterial {
    const key = `${colour}:${opacity}`
    const cached = glassByFinish.get(key)

    if (cached) {
      return cached
    }

    const material = tinted(new MeshBasicMaterial({ transparent: true, opacity }), partFill(colour))
    glassByFinish.set(key, material)
    owned.push(material)

    return material
  }

  function glass(geometry: BufferGeometry, colour: number, opacity = 0.55): Mesh {
    const mesh = new Mesh(geometry, glassMaterial(colour, opacity))
    const silhouette = new Mesh(createHullGeometry(geometry), glassHull)
    mesh.renderOrder = GLASS_RENDER_ORDER
    silhouette.renderOrder = GLASS_SILHOUETTE_RENDER_ORDER
    mesh.add(silhouette)

    return mesh
  }

  function createLed(colour: number): LedMaterials {
    const ledColour = new Color(colour)
    const materials = {
      colour: ledColour,
      fill: tinted(createFillMaterial(FINISHES.light.base), base),
      hull: tinted(createHullMaterial(ledColour), (finish) =>
        ledColour
          .clone()
          .lerp(new Color(finish.outline), 0.35)
          .lerp(new Color(finish.highlight), 0.2),
      ),
      crease: tinted(new LineBasicMaterial(), (finish) =>
        ledColour.clone().lerp(new Color(finish.highlight), 0.5),
      ),
      glow: new SpriteMaterial({
        map: glowTexture,
        color: colour,
        transparent: true,
        depthWrite: false,
        opacity: 0,
      }),
    }

    return {
      ...materials,
      dispose: () => {
        for (const material of [materials.fill, materials.hull, materials.crease]) {
          tints.delete(material)
          material.dispose()
        }
        materials.glow.dispose()
      },
    }
  }

  function ledBody(geometry: BufferGeometry, led: LedMaterials): Mesh {
    const mesh = new Mesh(geometry, led.fill)
    mesh.add(new Mesh(createHullGeometry(geometry), led.hull))
    addCreases(mesh, led.crease)

    return mesh
  }

  function segment(geometry: BufferGeometry, materials: DisplayMaterials): Mesh {
    return new Mesh(geometry, materials.unlit)
  }

  const displays = DISPLAY_COLOURS.map((colour) => {
    const lit = new MeshBasicMaterial({ color: colour })
    const glow = new SpriteMaterial({
      map: glowTexture,
      color: colour,
      transparent: true,
      depthWrite: false,
      opacity: 0.22,
    })
    owned.push(lit, glow)

    return { lit, unlit, glow }
  })

  // Unlit cathodes write no depth, so the lit numeral behind them is never cut away.
  const nixie = {
    lit: new MeshBasicMaterial({ color: NIXIE_GLOW, transparent: true, opacity: 1 }),
    unlit: tinted(
      new MeshBasicMaterial({ transparent: true, opacity: 0.6, depthWrite: false }),
      partFill(fills.unlitCathode),
    ),
    glow: new SpriteMaterial({
      map: glowTexture,
      color: NIXIE_GLOW,
      transparent: true,
      depthWrite: false,
      opacity: 0.28,
    }),
  }
  const tubeGlow = new SpriteMaterial({
    map: glowTexture,
    color: HEATER_GLOW,
    transparent: true,
    depthWrite: false,
    opacity: 0.32,
  })
  const ribbon = {
    fill: tinted(
      new MeshBasicMaterial({
        side: DoubleSide,
        polygonOffset: true,
        polygonOffsetFactor: 1,
        polygonOffsetUnits: 1,
      }),
      partFill(fills.copper),
    ),
    edge: tinted(new LineBasicMaterial(), outline),
  }
  owned.push(nixie.lit, nixie.unlit, nixie.glow, tubeGlow, ribbon.fill, ribbon.edge)

  return {
    body,
    detail,
    lead,
    glass,
    createLed,
    ledBody,
    segment,
    displays,
    nixie,
    tubeGlow,
    ribbon,
    glowTexture,
    baseFill,
    setTheme: (next) => {
      theme = next
      baseFill.set(FINISHES[theme].base)
      for (const [material, tint] of tints) {
        material.color.set(tint(FINISHES[theme], theme))
      }
    },
    dispose: () => {
      owned.forEach((material) => material.dispose())
      glowTexture.dispose()
    },
  }
}
