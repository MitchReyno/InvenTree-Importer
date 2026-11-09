import type { ManualPreviewDto, PreparationNodeDto } from '@invimport/contracts'
import {
  isEffectsPlan,
  locationCreateKey,
  logicalEffectKey,
} from '../execution/effects/effects-plan.ts'
import type { ExecutablePlan } from '../execution/media-plan.ts'

type Node = PreparationNodeDto
type Label = (observationId: string) => string | undefined

const clip = (text: string) => Array.from(text).slice(0, 512).join('')

const joined = (parts: (string | false | null | undefined)[]) => {
  const text = parts.filter((part): part is string => Boolean(part)).join(' · ')
  return text ? clip(text) : null
}

const KNOWN = new Set([
  'bench-stock-plan/1',
  'bench-media-plan/1',
  'bench-effects-plan/1',
  'bench-effects-plan/2',
])

/**
 * Every record a stored plan creates or uses, read without changing the plan or its preview.
 * Catalogue names come from the batch's retained observations; the plan keeps only their keys.
 */
export function preparationTree(
  plan: ExecutablePlan,
  preview: ManualPreviewDto,
  label: Label,
): Node[] | null {
  if (!KNOWN.has(plan.version)) {
    return null
  }
  const nodes: Node[] = []
  const seen = new Set<string>()

  const add = (
    node: Omit<Node, 'parent_key' | 'location_key' | 'lot_id' | 'part_subject_id' | 'detail'> &
      Partial<Node>,
  ) => {
    if (seen.has(node.key)) {
      return
    }
    seen.add(node.key)
    nodes.push({
      parent_key: null,
      location_key: null,
      lot_id: null,
      part_subject_id: null,
      detail: null,
      ...node,
      label: clip(node.label),
    })
  }

  const named = (observationId: string, fallback: string) => label(observationId) || fallback

  const bindings = isEffectsPlan(plan) ? plan.parts : []

  const effectOf = (lotId: string) => preview.effects.find((effect) => effect.lot_id === lotId)

  for (const binding of bindings) {
    const category = binding.spec.category
    add({
      key: `category:${category.pk}`,
      kind: 'category',
      label: named(category.observation_id, `Category ${category.pk}`),
      state: 'exists',
    })
  }
  for (const binding of bindings) {
    for (const company of [binding.spec.manufacturer?.company, binding.spec.supplier?.company]) {
      if (company) {
        add({
          key: `company:${company.pk}`,
          kind: 'company',
          label: named(company.observation_id, `Company ${company.pk}`),
          state: 'exists',
        })
      }
    }
  }
  // A record made by an earlier run is used by its pk, so it is keyed by that pk.
  for (const company of (isEffectsPlan(plan) && plan.companies) || []) {
    add({
      key: company.prior ? `company:${company.prior.pk}` : `company:new:${company.draftId}`,
      kind: 'company',
      label: company.spec.name,
      state: company.prior ? 'exists' : 'new',
      detail: company.prior
        ? null
        : joined([
            company.spec.description,
            company.spec.isManufacturer && 'Also a manufacturer',
            company.spec.logo && 'Logo sent with the create',
          ]),
    })
  }

  const newLocations = (isEffectsPlan(plan) && plan.locations) || []

  const locationKey = (operation: ExecutablePlan['operations'][number]) => {
    if (operation.location !== null) {
      return `location:${operation.location}`
    }
    const pending = 'locationOperationKey' in operation ? operation.locationOperationKey : null
    const draft = pending
      ? newLocations.find((binding) => locationCreateKey(binding.draftId) === pending)
      : undefined
    return draft ? locationNodeKey(draft) : null
  }

  const locationNodeKey = (binding: (typeof newLocations)[number]) =>
    binding.prior ? `location:${binding.prior.pk}` : `location:new:${binding.draftId}`

  for (const operation of plan.operations) {
    if (operation.location !== null) {
      add({
        key: `location:${operation.location}`,
        kind: 'location',
        label: effectOf(operation.operationKey)?.location_label ?? `Location ${operation.location}`,
        state: 'exists',
      })
    }
  }
  for (const binding of newLocations) {
    add({
      key: locationNodeKey(binding),
      kind: 'location',
      label: binding.spec.name,
      state: binding.prior ? 'exists' : 'new',
      detail: binding.prior
        ? null
        : joined([
            binding.spec.description,
            binding.spec.parent && `Inside location ${binding.spec.parent}`,
          ]),
    })
  }

  // A Part made by an earlier run is used by pk; it still belongs to its batch Part.
  const subjectOf = (operation: ExecutablePlan['operations'][number]) => {
    if (operation.part !== null) {
      return bindings.find((binding) => binding.prior?.pk === operation.part)?.subjectId ?? null
    }
    const key = 'partOperationKey' in operation ? operation.partOperationKey : null
    return (
      bindings.find((binding) => logicalEffectKey(binding.subjectId, 'create_part') === key)
        ?.subjectId ?? null
    )
  }

  const partKey = (operation: ExecutablePlan['operations'][number]) => {
    const subject = subjectOf(operation)
    return subject ? `part:${subject}` : `part:pk:${operation.part}`
  }

  for (const binding of bindings) {
    add({
      key: `part:${binding.subjectId}`,
      kind: 'part',
      label: binding.spec.name,
      state: binding.prior ? 'exists' : 'new',
      parent_key: `category:${binding.spec.category.pk}`,
      part_subject_id: binding.subjectId,
      detail: binding.prior
        ? null
        : joined([
            binding.spec.description,
            binding.spec.tags.length > 0 && `Tags: ${binding.spec.tags.join(', ')}`,
          ]),
    })
  }
  for (const operation of plan.operations) {
    if (operation.part !== null && !subjectOf(operation)) {
      add({
        key: `part:pk:${operation.part}`,
        kind: 'part',
        label: effectOf(operation.operationKey)?.part_label ?? `Part ${operation.part}`,
        state: 'exists',
      })
    }
  }
  for (const binding of bindings) {
    const parent = `part:${binding.subjectId}`
    const state = binding.prior ? 'exists' : 'new'
    const owned = { parent_key: parent, part_subject_id: binding.subjectId, state } as const
    for (const parameter of binding.spec.parameters) {
      const template = parameter.template
      add({
        key: `parameter:${binding.subjectId}:${template.pk}`,
        kind: 'parameter',
        label: `${named(template.observation_id, `Template ${template.pk}`)}: ${parameter.value}`,
        ...owned,
      })
    }
    const { manufacturer, supplier } = binding.spec
    if (manufacturer) {
      add({
        key: `manufacturer_part:${binding.subjectId}`,
        kind: 'manufacturer_part',
        label: `${manufacturer.mpn} · ${named(manufacturer.company.observation_id, `Company ${manufacturer.company.pk}`)}`,
        ...owned,
      })
    }
    if (supplier) {
      add({
        key: `supplier_part:${binding.subjectId}`,
        kind: 'supplier_part',
        label: `${supplier.sku} · ${named(supplier.company.observation_id, `Company ${supplier.company.pk}`)}`,
        ...owned,
      })
    }
  }

  for (const operation of plan.operations) {
    const effect = effectOf(operation.operationKey)
    add({
      key: `stock:${operation.operationKey}`,
      kind: 'stock_item',
      label: `${effect?.lot_label ?? 'Lot'} · ${operation.quantity}`,
      state: 'new',
      parent_key: partKey(operation),
      location_key: locationKey(operation),
      lot_id: operation.operationKey,
      part_subject_id: subjectOf(operation),
    })
  }
  for (const attachment of 'attachments' in plan ? plan.attachments : []) {
    const shown = preview.attachments?.find((item) => item.artifact_key === attachment.artifactKey)
    const operation = plan.operations.find(
      (value) => value.operationKey === attachment.stockOperationKey,
    )
    add({
      key: `attachment:${attachment.artifactKey}`,
      kind: 'attachment',
      label: shown?.evidence_label ?? 'Attachment',
      state: 'new',
      parent_key: `stock:${attachment.stockOperationKey}`,
      lot_id: attachment.stockOperationKey,
      part_subject_id: operation ? subjectOf(operation) : null,
    })
  }
  for (const attachment of preview.part_attachments ?? []) {
    const kind = attachment.media_type === 'application/pdf' ? 'PDF' : 'Image'
    add({
      key: `attachment:${attachment.artifact_key}`,
      kind: 'attachment',
      label: `${kind} for ${attachment.part_label}`,
      state: attachment.prior_remote_pk ? 'exists' : 'new',
      parent_key:
        attachment.part_id === null
          ? `part:${attachment.part_subject_id}`
          : bindings.some((binding) => binding.subjectId === attachment.part_subject_id)
            ? `part:${attachment.part_subject_id}`
            : `part:pk:${attachment.part_id}`,
      part_subject_id: attachment.part_subject_id,
    })
  }
  return nodes
}
