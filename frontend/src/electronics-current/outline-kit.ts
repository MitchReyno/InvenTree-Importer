import {
  BackSide,
  BufferAttribute,
  Color,
  DataTexture,
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
  BASE_FILL,
  CREASE_COLOUR,
  DISPLAY_COLOURS,
  OUTLINE_COLOUR,
  UNLIT_SEGMENT,
} from './finishes'

// Silhouette shell thickness in scene units (about 1 px at the masthead scale).
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

export interface OutlineKit {
  /** Filled part surface with a dark silhouette and faint crease lines. */
  body: (geometry: BufferGeometry, fill: number) => Mesh
  /** Surface detail (bands, marks, labels): fill and crease lines, no silhouette. */
  detail: (geometry: BufferGeometry, fill: number) => Mesh
  /** Thin wire or pin drawn as a solid stroke. */
  lead: (geometry: BufferGeometry) => Mesh
  /** Translucent glass whose silhouette draws after it, so its far side never shows. */
  glass: (geometry: BufferGeometry, fill: number) => Mesh
  createLed: (colour: number) => LedMaterials
  ledBody: (geometry: BufferGeometry, led: LedMaterials) => Mesh
  /** Display segment: plain fill, switched between lit and unlit by the display. */
  segment: (geometry: BufferGeometry, materials: DisplayMaterials) => Mesh
  displays: DisplayMaterials[]
  glowTexture: DataTexture
  baseFill: Color
  dispose: () => void
}

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
  texture.needsUpdate = true

  return texture
}

export function createOutlineKit(): OutlineKit {
  const owned: Material[] = []
  const fillsByColour = new Map<number, MeshBasicMaterial>()
  const hull = createHullMaterial(OUTLINE_COLOUR)
  const glassHull = createHullMaterial(OUTLINE_COLOUR)
  const crease = new LineBasicMaterial({ color: CREASE_COLOUR })
  const solid = new MeshBasicMaterial({ color: OUTLINE_COLOUR })
  const glowTexture = createGlowTexture()
  const unlit = new MeshBasicMaterial({ color: UNLIT_SEGMENT })

  glassHull.transparent = true
  owned.push(hull, glassHull, crease, solid, unlit)

  function fill(colour: number): MeshBasicMaterial {
    const cached = fillsByColour.get(colour)

    if (cached) {
      return cached
    }

    const material = createFillMaterial(colour)
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

  function glass(geometry: BufferGeometry, colour: number): Mesh {
    const material = new MeshBasicMaterial({ color: colour, transparent: true, opacity: 0.55 })
    const mesh = new Mesh(geometry, material)
    const silhouette = new Mesh(createHullGeometry(geometry), glassHull)
    owned.push(material)
    mesh.renderOrder = 1
    silhouette.renderOrder = 2
    mesh.add(silhouette)

    return mesh
  }

  function createLed(colour: number): LedMaterials {
    const ledColour = new Color(colour)
    const outlineTint = ledColour
      .clone()
      .lerp(new Color(OUTLINE_COLOUR), 0.35)
      .lerp(new Color(0xffffff), 0.2)
    const materials = {
      colour: ledColour,
      fill: createFillMaterial(BASE_FILL),
      hull: createHullMaterial(outlineTint),
      crease: new LineBasicMaterial({ color: ledColour.clone().lerp(new Color(0xffffff), 0.5) }),
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
        materials.fill.dispose()
        materials.hull.dispose()
        materials.crease.dispose()
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

  return {
    body,
    detail,
    lead,
    glass,
    createLed,
    ledBody,
    segment,
    displays,
    glowTexture,
    baseFill: new Color(BASE_FILL),
    dispose: () => {
      owned.forEach((material) => material.dispose())
      glowTexture.dispose()
    },
  }
}
