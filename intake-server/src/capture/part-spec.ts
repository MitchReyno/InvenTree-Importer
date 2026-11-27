import { approvedTagNamesValid } from '#/inventory/tags.ts'
import type { CaptureObservationDto, InventoryPartSpecDto } from '@invimport/contracts'

export class PartSpecError extends Error {
  constructor(public readonly code: string) {
    super(code)
  }
}

export function partSpecReferences(spec: InventoryPartSpecDto) {
  return [
    spec.category,
    ...spec.parameters.flatMap((parameter) => [parameter.template, parameter.category_mapping]),
    ...(spec.manufacturer ? [spec.manufacturer.company] : []),
    ...(spec.supplier ? [spec.supplier.company] : []),
  ]
}

/** Mapping identity and semantic roles must come from complete target observations. */
export function validatePartSpec(
  spec: InventoryPartSpecDto,
  contextId: string,
  observations: readonly CaptureObservationDto[],
) {
  if (!approvedTagNamesValid(spec.tags)) {
    throw new PartSpecError('invalid_or_duplicate_tag_name')
  }
  const templateIds = spec.parameters.map((parameter) => parameter.template.pk)
  if (new Set(templateIds).size !== templateIds.length) {
    throw new PartSpecError('duplicate_parameter_mapping')
  }
  for (const reference of partSpecReferences(spec)) {
    const observed = observations.find((item) => item.id === reference.observation_id)
    if (
      !observed ||
      reference.target_context_id !== contextId ||
      observed.target_context_id !== contextId ||
      observed.model !== reference.model ||
      observed.pk !== reference.pk ||
      observed.mapping?.kind !== reference.model
    ) {
      throw new PartSpecError('mapping_observation_invalid')
    }
    if (
      observed.mapping.kind === 'parameter_template' &&
      (!observed.mapping.enabled ||
        (observed.mapping.model_type !== null && observed.mapping.model_type !== 'part.part'))
    ) {
      throw new PartSpecError('parameter_category_incompatible')
    }
    if (observed.mapping.kind === 'category_parameter') {
      // Every parameter citing this observation must use its template.
      const parameters = spec.parameters.filter(
        (item) => item.category_mapping.observation_id === reference.observation_id,
      )
      const templateId = observed.mapping.template_id
      if (
        !parameters.length ||
        observed.mapping.category_id !== spec.category.pk ||
        parameters.some((parameter) => parameter.template.pk !== templateId)
      ) {
        throw new PartSpecError('parameter_category_incompatible')
      }
    }
    if (observed.mapping.kind === 'company') {
      const manufacturer = spec.manufacturer?.company.observation_id === reference.observation_id
      const supplier = spec.supplier?.company.observation_id === reference.observation_id
      if (
        (manufacturer && !observed.mapping.manufacturer) ||
        (supplier && !observed.mapping.supplier)
      ) {
        throw new PartSpecError('company_role_incompatible')
      }
    }
  }
}
