import type { Group, Mesh } from 'three'
import type { DisplayMaterials, LedMaterials, OutlineKit } from './outline-kit'

export type PartType =
  | 'resistor'
  | 'resistorSmall'
  | 'resistorVertical'
  | 'resistorPower'
  | 'ceramicDisc'
  | 'blueCeramic'
  | 'monolithic'
  | 'electrolytic'
  | 'electrolyticLarge'
  | 'electrolyticAxial'
  | 'electrolyticSmd'
  | 'filmCapacitor'
  | 'tantalum'
  | 'led'
  | 'led3mm'
  | 'ledRectangular'
  | 'diode'
  | 'glassDiode'
  | 'powerDiode'
  | 'bridgeRectifier'
  | 'to92'
  | 'to126'
  | 'to18'
  | 'regulator'
  | 'dip'
  | 'eprom'
  | 'soic'
  | 'sot23'
  | 'qfp'
  | 'smdChip'
  | 'crystal'
  | 'inductor'
  | 'transformer'
  | 'trimpot'
  | 'trimpotVertical'
  | 'potentiometer'
  | 'tactileButton'
  | 'toggleSwitch'
  | 'dipSwitch'
  | 'pinHeader'
  | 'relay'
  | 'display14'
  | 'display7'

export type DisplayMode = 'text' | 'count' | 'seven'

export interface DisplayState {
  digits: Map<string, Mesh>[]
  materials: DisplayMaterials
  mode: DisplayMode
  step: number | null
}

/** A part ready to place: its geometry plus optional behaviour hooks. */
export interface PartModel {
  group: Group
  /** Extra size factor for parts modelled larger or smaller than their siblings. */
  scale: number
  /** Axial parts are modelled along Y and laid flat when placed. */
  layFlat: boolean
  /** Displays drift loosely towards the viewer so their characters stay readable. */
  facesViewer: boolean
  led?: LedMaterials
  display?: DisplayState
  /** Per-frame animation in scene time (seconds) and scaled frame time. */
  animate?: (time: number, frameSeconds: number, seed: number) => void
  /** Pointer disturbance: influence 0..1 and pointer speed in px/s. */
  react?: (influence: number, pointerSpeed: number, time: number) => void
}

export interface BuildContext {
  kit: OutlineKit
  random: () => number
}

export type PartBuilder = (context: BuildContext) => PartModel

export interface PartOptions {
  scale?: number
  layFlat?: boolean
  facesViewer?: boolean
  led?: LedMaterials
  display?: DisplayState
  animate?: PartModel['animate']
  react?: PartModel['react']
}

export function createPart(group: Group, options: PartOptions = {}): PartModel {
  return {
    group,
    scale: options.scale ?? 1,
    layFlat: options.layFlat ?? false,
    facesViewer: options.facesViewer ?? false,
    led: options.led,
    display: options.display,
    animate: options.animate,
    react: options.react,
  }
}
