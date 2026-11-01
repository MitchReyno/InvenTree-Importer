import { Field } from '../ui/primitives'
import { Button, Input, Label, Select, Small } from '../ui/primitives'
import { useState } from 'react'
import type { CaptureObservationDto } from '@invimport/contracts'
import type { Snapshot, CaptureWorkspaceProps, Reference } from '../../capture/types'
type ReferenceFieldProps = {
  title: string
  model: 'part' | 'location'
  value: Reference
  defaults: boolean
  batch: Snapshot
  onChange: (value: Reference) => void
  observe: CaptureWorkspaceProps['observe']
}

export function ReferenceField({ title, model, value, defaults, batch, onChange, observe }: ReferenceFieldProps) {
  const [pk, setPk] = useState('')
  const observations = batch.observations.filter(o => o.model === model)
  function choose(o: CaptureObservationDto) { onChange({ mode: 'set', value: { observation_id: o.id, target_context_id: o.target_context_id, model: o.model, pk: o.pk } }) }
  return <Field ><Label>{title} selection<Select value={value.mode === 'set' ? value.value.observation_id : value.mode} onChange={e => { const o = observations.find(o => o.id === e.target.value); if (o) choose(o); else onChange({ mode: e.target.value as 'unset' | 'unknown' | 'clear' | 'inherit' }) }}>{!defaults && <option value="inherit">Use batch default</option>}<option value="unset">Not selected</option><option value="unknown">Explicitly unknown</option><option value="clear">Explicitly clear</option>{observations.map(o => <option key={o.id} value={o.id}>{o.label} (#{o.pk}) · observed</option>)}</Select></Label><Label>{title} record ID<Input inputMode="numeric" value={pk} onChange={e => setPk(e.target.value)} placeholder="Existing numeric ID" /></Label><Button type="button" onClick={() => { void observe(model, pk) }}>Read {title.toLowerCase()}</Button><Small>Read-only lookup on the server-configured target. Inspect the observed name, then select it. A read is not a human selection or approval.</Small></Field>
}
