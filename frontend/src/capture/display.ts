import type { Snapshot, Quantity, Reference } from './types'

export function display(value: Quantity | Reference, batch: Snapshot, field: 'quantity' | 'location'): string {
  if (value.mode === 'inherit') return `Inherited · ${display(batch.defaults[field], batch, field)}`
  if (value.mode !== 'set') return { unset: 'Not selected', unknown: 'Explicitly unknown', clear: 'Explicitly cleared' }[value.mode]
  const selected = value.value
  return typeof selected === 'string' ? `${selected} pieces · Human` : `${batch.observations.find(o => o.id === selected.observation_id)?.label ?? 'Retained observation'} (#${selected.pk}) · Human choice`
}
