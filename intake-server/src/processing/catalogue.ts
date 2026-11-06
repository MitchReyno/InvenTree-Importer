import type {
  CaptureObservationDto,
  CatalogueProposalDto,
  InventoryPartSpecDto,
} from '@invimport/contracts'

export type CatalogueUnsupportedReason =
  | 'new_category'
  | 'new_parameter_template'
  | 'parameter_mapping_missing'
  | 'parameter_category_incompatible'
  | 'category_not_applicable'
  | 'new_manufacturer'
  | 'new_supplier'
  | 'supplier_sku_missing'
  | 'supplier_price_unsupported'
  | 'company_role_incompatible'
  | 'description_unsupported'
  | 'mapping_observation_invalid'

export type CatalogueAssessment =
  | { path: string; status: 'applicable' }
  | { path: string; status: 'unsupported'; reason: CatalogueUnsupportedReason }

interface Reference {
  observation_id: string
  target_context_id: string
  model: string
  pk: string
}

/** The same identity checks `validatePartSpec` applies to a mapped reference. */
function observedMapping(
  reference: Reference,
  contextId: string,
  observations: readonly CaptureObservationDto[],
) {
  const observed = observations.find((item) => item.id === reference.observation_id)
  if (
    !observed ||
    reference.target_context_id !== contextId ||
    observed.target_context_id !== contextId ||
    observed.model !== reference.model ||
    observed.pk !== reference.pk ||
    observed.mapping?.kind !== reference.model
  ) {
    return undefined
  }
  return observed.mapping
}

/**
 * Says which catalogue values could enter a Part spec as they stand. Unsupported values stay in
 * the proposal and are shown with their reason; nothing here writes a Part spec.
 */
export function assessCatalogue(
  catalogue: CatalogueProposalDto,
  contextId: string,
  observations: readonly CaptureObservationDto[],
): CatalogueAssessment[] {
  const result: CatalogueAssessment[] = []

  const unsupported = (path: string, reason: CatalogueUnsupportedReason) =>
    result.push({ path, status: 'unsupported', reason })

  const applicable = (path: string) => result.push({ path, status: 'applicable' })

  let categoryPk: string | undefined
  if (catalogue.category?.choice === 'proposed_new') {
    unsupported('category', 'new_category')
  } else if (catalogue.category) {
    if (observedMapping(catalogue.category.reference, contextId, observations)) {
      categoryPk = catalogue.category.reference.pk
      applicable('category')
    } else {
      unsupported('category', 'mapping_observation_invalid')
    }
  }

  catalogue.parameters.forEach((parameter, index) => {
    const path = `parameters.${index}`
    if (!parameter.template) {
      return unsupported(path, 'new_parameter_template')
    }
    if (!parameter.category_mapping) {
      return unsupported(path, 'parameter_mapping_missing')
    }
    const template = observedMapping(parameter.template, contextId, observations)
    const mapping = observedMapping(parameter.category_mapping, contextId, observations)
    if (!template || !mapping) {
      return unsupported(path, 'mapping_observation_invalid')
    }
    if (categoryPk === undefined) {
      return unsupported(path, 'category_not_applicable')
    }
    if (
      template.kind !== 'parameter_template' ||
      mapping.kind !== 'category_parameter' ||
      !template.enabled ||
      (template.model_type !== null && template.model_type !== 'part.part') ||
      mapping.category_id !== categoryPk ||
      mapping.template_id !== parameter.template.pk
    ) {
      return unsupported(path, 'parameter_category_incompatible')
    }
    applicable(path)
  })

  const company = (
    path: 'manufacturer' | 'supplier',
    choice: NonNullable<CatalogueProposalDto['manufacturer']>['company'],
  ) => {
    if (choice.choice === 'proposed_new') {
      // New companies come only from the batch's supplier draft, never from a Part spec.
      unsupported(path, path === 'manufacturer' ? 'new_manufacturer' : 'new_supplier')
      return false
    }
    const mapping = observedMapping(choice.reference, contextId, observations)
    if (!mapping || mapping.kind !== 'company') {
      unsupported(path, 'mapping_observation_invalid')
      return false
    }
    if (path === 'manufacturer' ? !mapping.manufacturer : !mapping.supplier) {
      unsupported(path, 'company_role_incompatible')
      return false
    }
    return true
  }

  if (catalogue.manufacturer && company('manufacturer', catalogue.manufacturer.company)) {
    applicable('manufacturer')
  }
  if (catalogue.supplier) {
    if (company('supplier', catalogue.supplier.company)) {
      if (catalogue.supplier.sku === null) {
        unsupported('supplier', 'supplier_sku_missing')
      } else {
        applicable('supplier')
      }
    }
    if (catalogue.supplier.price) {
      unsupported('supplier.price', 'supplier_price_unsupported')
    }
  }
  if (catalogue.description) {
    // The Part spec has no description field yet.
    unsupported('description', 'description_unsupported')
  }
  return result
}

/**
 * The Part spec an operator could accept from a catalogue proposal: applicable values only, so
 * it passes `validatePartSpec` as it stands. Without an applicable category there is no spec;
 * unsupported values stay in the proposal and are never copied.
 */
export function applicableCatalogueSpec(
  catalogue: CatalogueProposalDto,
  contextId: string,
  observations: readonly CaptureObservationDto[],
  base: { name: string; tags: string[] },
): InventoryPartSpecDto | null {
  const assessed = new Map(
    assessCatalogue(catalogue, contextId, observations).map((item) => [item.path, item.status]),
  )

  const ok = (path: string) => assessed.get(path) === 'applicable'

  if (!ok('category') || catalogue.category?.choice !== 'existing') {
    return null
  }

  const company = (choice: { choice: string; reference?: unknown }) =>
    choice.choice === 'existing'
      ? (choice.reference as InventoryPartSpecDto['category'] & { model: 'company' })
      : null

  const manufacturer =
    catalogue.manufacturer && ok('manufacturer')
      ? { company: company(catalogue.manufacturer.company)!, mpn: catalogue.manufacturer.mpn }
      : null
  const supplier =
    catalogue.supplier && ok('supplier') && catalogue.supplier.sku !== null
      ? { company: company(catalogue.supplier.company)!, sku: catalogue.supplier.sku }
      : null
  return {
    name: base.name,
    category: catalogue.category.reference,
    parameters: catalogue.parameters.flatMap((parameter, index) =>
      ok(`parameters.${index}`) && parameter.template && parameter.category_mapping
        ? [
            {
              template: parameter.template,
              category_mapping: parameter.category_mapping,
              value: parameter.value,
            },
          ]
        : [],
    ),
    manufacturer,
    supplier,
    tags: base.tags,
  } as InventoryPartSpecDto
}
