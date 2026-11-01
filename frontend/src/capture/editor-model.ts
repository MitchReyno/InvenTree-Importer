import type { CaptureEditDto } from '@invimport/contracts'
import type { Snapshot, Quantity, Reference } from './types'

const empty = { mode: 'unset' } as const

export type CaptureEditorValues = {
  label: string
  quantity: Quantity
  location: Reference
  choice: Reference
  partId: string
  text: string
  noteSubject: string
}

export function captureEditorDefaults(batch: Snapshot, selected: string): CaptureEditorValues {
  const lot = batch.lots.find((candidate) => candidate.id === selected)
  const part = batch.parts.find((candidate) => candidate.id === selected)
  const defaults = selected === 'defaults'

  return {
    label: lot?.label ?? part?.label ?? (selected === 'batch' ? batch.title : ''),
    quantity: lot?.quantity ?? (defaults ? batch.defaults.quantity : empty),
    location: lot?.location ?? (defaults ? batch.defaults.location : empty),
    choice: part?.choice ?? empty,
    partId: lot?.part_subject_id ?? '',
    text: '',
    noteSubject: '',
  }
}

export function captureEditorChange(
  batch: Snapshot,
  selected: string,
  values: CaptureEditorValues,
): CaptureEditDto['change'] {
  const lot = batch.lots.find((candidate) => candidate.id === selected)
  const part = batch.parts.find((candidate) => candidate.id === selected)
  const defaults = selected === 'defaults'
  const { label, quantity, location, choice, partId, text, noteSubject } = values

  if (defaults) {
    return { kind: 'defaults', quantity, location }
  }
  if (lot) {
    return { kind: 'lot', id: lot.id, label, part_subject_id: partId || null, quantity, location }
  }
  if (part) {
    return {
      kind: 'part',
      id: part.id,
      label,
      choice: choice.mode === 'inherit' ? empty : choice,
    }
  }
  if (selected === 'add_part') {
    return { kind: 'add_part', label }
  }
  if (selected === 'add_lot') {
    return { kind: 'add_lot', label, note: text, part_subject_id: partId || null }
  }
  if (selected === 'note') {
    return { kind: 'note', subject_id: noteSubject || null, text }
  }
  return { kind: 'batch', title: label }
}
