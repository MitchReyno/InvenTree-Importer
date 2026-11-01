import { Button, Fieldset, Form, Input, Label, Select, Small, TextArea } from '../ui/primitives'
import { useState, type FormEvent } from 'react'
import type { Snapshot, CaptureWorkspaceProps, Quantity, Reference } from '../../capture/types'
import type { CaptureEditDto } from '@invimport/contracts'
import { QuantityField } from './QuantityField'
import { ReferenceField } from './ReferenceField'

const empty = { mode: 'unset' } as const
type EditorProps = {
  batch: Snapshot
  selected: string
  frozen: boolean
  dirty: boolean
  onDirty: (value: boolean) => void
  edit: CaptureWorkspaceProps['edit']
  observe: CaptureWorkspaceProps['observe']
}

export function CaptureEditor({ batch, selected, frozen, dirty, onDirty, edit, observe }: EditorProps) {
  const lot = batch.lots.find(l => l.id === selected)
  const part = batch.parts.find(p => p.id === selected)
  const defaults = selected === 'defaults'
  const [label, setLabel] = useState(lot?.label ?? part?.label ?? (selected === 'batch' ? batch.title : ''))
  const [quantity, setQuantity] = useState<Quantity>(lot?.quantity ?? (defaults ? batch.defaults.quantity : empty))
  const [location, setLocation] = useState<Reference>(lot?.location ?? (defaults ? batch.defaults.location : empty))
  const [choice, setChoice] = useState<Reference>(part?.choice ?? empty)
  const [partId, setPartId] = useState(lot?.part_subject_id ?? '')
  const [text, setText] = useState('')
  const [noteSubject, setNoteSubject] = useState('')
  function change(): CaptureEditDto['change'] {
    if (defaults) return { kind: 'defaults', quantity, location }
    if (lot) return { kind: 'lot', id: lot.id, label, part_subject_id: partId || null, quantity, location }
    if (part) return { kind: 'part', id: part.id, label, choice: choice.mode === 'inherit' ? empty : choice }
    if (selected === 'add_part') return { kind: 'add_part', label }
    if (selected === 'add_lot') return { kind: 'add_lot', label, note: text, part_subject_id: partId || null }
    if (selected === 'note') return { kind: 'note', subject_id: noteSubject || null, text }
    return { kind: 'batch', title: label }
  }
  function saveChanges(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    void edit(change())
  }
  return <Form onChange={() => onDirty(true)} onSubmit={saveChanges}>
    <Fieldset disabled={frozen}>
      {!defaults && selected !== 'note' && <Label>{part || selected === 'add_part' ? 'Part label' : selected === 'batch' ? 'Title' : 'Lot label'}<Input required maxLength={256} value={label} onChange={e => setLabel(e.target.value)} /></Label>}
      {(lot || selected === 'add_lot') && <Label>Shared Part proposal<Select value={partId} onChange={e => setPartId(e.target.value)}><option value="">Not linked yet</option>{batch.parts.map(p => <option value={p.id} key={p.id}>{p.label}</option>)}</Select></Label>}
      {(defaults || lot) && <><QuantityField value={quantity} defaults={defaults} onChange={setQuantity} /><ReferenceField title="Location" model="location" value={location} defaults={defaults} batch={batch} onChange={v => { setLocation(v); onDirty(true) }} observe={observe} /></>}
      {part && <ReferenceField title="Existing Part" model="part" value={choice} defaults batch={batch} onChange={v => { setChoice(v); onDirty(true) }} observe={observe} />}
      {selected === 'note' && <Label>Note relates to<Select value={noteSubject} onChange={e => setNoteSubject(e.target.value)}><option value="">Batch</option>{[...batch.parts, ...batch.lots].map(s => <option key={s.id} value={s.id}>{s.label}</option>)}</Select></Label>}
      {(selected === 'add_lot' || selected === 'note') && <Label>Human observation / note<TextArea maxLength={8192} value={text} onChange={e => setText(e.target.value)} /></Label>}
      <Button disabled={frozen || (!dirty && !selected.startsWith('add_'))}>Save {defaults ? 'shared defaults' : 'human changes'}</Button>
      {!dirty && !frozen && !selected.startsWith('add_') && <Small>Saved values are unchanged. Edit a field to save a new revision.</Small>}
    </Fieldset>
    {dirty && <Button type="button" onClick={() => { onDirty(false); /* Remount through explicit reset rather than silently dropping stale values. */ locationReload() }}>Discard unsaved input</Button>}
  </Form>
}
function locationReload() { window.location.reload() }

