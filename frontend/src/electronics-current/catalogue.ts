import type { PartBuilder, PartType } from './part-model'
import { displayBuilders } from './parts/displays'
import { electromechanicalBuilders } from './parts/electromechanical'
import { integratedBuilders } from './parts/integrated'
import { passiveBuilders } from './parts/passives'
import { semiconductorBuilders } from './parts/semiconductors'

/** Every part type has exactly one builder; the compiler enforces completeness. */
export const partBuilders: Record<PartType, PartBuilder> = {
  ...passiveBuilders,
  ...semiconductorBuilders,
  ...integratedBuilders,
  ...electromechanicalBuilders,
  ...displayBuilders,
}

/**
 * Relative frequency of each type in the flow. Resistors are the most common
 * part on a real bench; single-weight types are deliberate occasional finds.
 */
export const PART_WEIGHTS: Record<PartType, number> = {
  resistor: 9,
  resistorSmall: 2,
  resistorVertical: 2,
  resistorPower: 1,
  ceramicDisc: 2,
  blueCeramic: 2,
  monolithic: 2,
  electrolytic: 2,
  electrolyticLarge: 1,
  electrolyticAxial: 1,
  electrolyticSmd: 1,
  filmCapacitor: 2,
  tantalum: 2,
  led: 2,
  led3mm: 1,
  ledRectangular: 1,
  diode: 2,
  glassDiode: 2,
  powerDiode: 1,
  bridgeRectifier: 1,
  to92: 2,
  to126: 1,
  to18: 1,
  regulator: 2,
  dip: 2,
  eprom: 2,
  soic: 2,
  sot23: 1,
  qfp: 1,
  smdChip: 1,
  crystal: 1,
  inductor: 2,
  transformer: 1,
  trimpot: 2,
  trimpotVertical: 2,
  potentiometer: 1,
  tactileButton: 2,
  toggleSwitch: 1,
  dipSwitch: 1,
  pinHeader: 2,
  relay: 1,
  display14: 2,
  display7: 2,
}

const weightedTypes = Object.entries(PART_WEIGHTS) as [PartType, number][]

const totalWeight = weightedTypes.reduce((sum, [, weight]) => sum + weight, 0)

export function pickPartType(random: () => number): PartType {
  let remaining = random() * totalWeight

  for (const [type, weight] of weightedTypes) {
    remaining -= weight

    if (remaining < 0) {
      return type
    }
  }

  return weightedTypes[weightedTypes.length - 1][0]
}
