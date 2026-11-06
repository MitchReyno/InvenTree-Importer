import {
  assessCatalogue,
  type CaptureObservationDto,
  type CatalogueProposalDto,
  type InventoryPartSpecDto,
} from '@invimport/contracts'

// The rule lives in contracts with the records projection; this keeps the server's import path.
export {
  assessCatalogue,
  type CatalogueAssessment,
  type CatalogueUnsupportedReason,
} from '@invimport/contracts'

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
    // A description fits the Part spec only when it passes the Part description rule.
    ...(catalogue.description && ok('description')
      ? { description: catalogue.description.text }
      : {}),
    tags: base.tags,
  } as InventoryPartSpecDto
}
