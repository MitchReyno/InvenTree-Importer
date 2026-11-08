import type { CaptureSnapshotDto } from '@invimport/contracts'

type Part = CaptureSnapshotDto['parts'][number]

export type PartFacts = {
  manufacturer?: string
  mpn?: string
  supplierSku?: string
  package?: string
  dateCode?: string
}

const PACKAGE = /^package\b/i
const DATE_CODE = /^(date code|d\/c)$/i

/** What a new Part's spec says of the item; an existing Part's values live in InvenTree. */
export function partFacts(batch: CaptureSnapshotDto, part: Part | undefined): PartFacts {
  if (part?.choice.mode !== 'create') {
    return {}
  }
  const { spec } = part.choice

  const label = (id: string) => batch.observations.find((item) => item.id === id)?.label

  const parameter = (pattern: RegExp) =>
    spec.parameters.find((item) => pattern.test(label(item.template.observation_id) ?? ''))?.value

  const facts: PartFacts = {
    manufacturer: spec.manufacturer ? label(spec.manufacturer.company.observation_id) : undefined,
    mpn: spec.manufacturer?.mpn,
    supplierSku: spec.supplier?.sku,
    package: parameter(PACKAGE),
    dateCode: parameter(DATE_CODE),
  }
  return Object.fromEntries(
    Object.entries(facts).filter(([, value]) => value !== undefined),
  ) as PartFacts
}
