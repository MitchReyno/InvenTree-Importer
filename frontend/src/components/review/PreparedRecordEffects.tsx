import type { SupportedEffectPreviewDto } from '@invimport/contracts'
import { Paragraph, Small } from '../ui/primitives'

/** New locations and suppliers are separate approved creates, not shared Part operations. */
export function isRecordEffect(effect: SupportedEffectPreviewDto) {
  return effect.kind === 'create_location' || effect.kind === 'create_company'
}

const fieldLabels: Record<string, string> = {
  name: 'Name',
  description: 'Description',
  parent: 'Parent location',
  is_manufacturer: 'Also a manufacturer',
  image: 'Logo',
}

function shown(field: string, value: string) {
  if (field === 'parent') {
    return value ? `#${value}` : 'None'
  }
  if (field === 'image') {
    return value ? 'Sent with the create' : 'None'
  }
  if (field === 'is_manufacturer') {
    return value === 'true' ? 'Yes' : 'No'
  }
  return value || '—'
}

export function PreparedRecordEffects({ effects }: { effects: SupportedEffectPreviewDto[] }) {
  const records = effects.filter(isRecordEffect)
  if (!records.length) {
    return null
  }
  return (
    <section aria-label="New inventory records">
      <Paragraph>
        <strong>New records · {records.length}</strong>
      </Paragraph>
      {records.map((effect) => (
        <div key={effect.operation_key}>
          <strong>{effect.label}</strong>
          {Object.entries(effect.inputs)
            .filter(([field]) => field !== 'is_supplier')
            .map(([field, value]) => (
              <Small key={field}>
                {fieldLabels[field] ?? field}: {shown(field, value)}
              </Small>
            ))}
          <Small>
            Created once by this run. A later run reuses the confirmed record; an uncertain create
            is never repeated.
          </Small>
        </div>
      ))}
    </section>
  )
}
