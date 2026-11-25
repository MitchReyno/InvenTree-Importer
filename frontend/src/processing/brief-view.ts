import type { BriefEntryDto, SessionBriefDto } from '@invimport/contracts'

type Entry<K extends BriefEntryDto['kind']> = Extract<BriefEntryDto, { kind: K }>
type Observation = Entry<'observation'>['observation']

/** The operator's facts the brief carries apart from corrections, which sit with their reading. */
export type BriefFact = Entry<'answer' | 'note' | 'setting_note' | 'lot_edit'>

/** An observation as the session was given it, with the operator's corrections to it, in the brief's order. */
export type BriefObservationRow = {
  observation: Observation
  corrections: Entry<'correction'>[]
}

/** A brief's entries grouped the way the session page shows them. */
export type BriefView = {
  title: string
  batch: Entry<'batch'> | null
  identities: Entry<'identity'>[]
  observations: BriefObservationRow[]
  /** Corrections to observations the brief doesn't list, such as an Examine lead's. */
  corrections: Entry<'correction'>[]
  facts: BriefFact[]
  instructions: Entry<'instruction'>[]
  asked: Entry<'question'>[]
  evidence: Entry<'evidence'>[]
  lots: Entry<'lot'>[]
  parts: Entry<'part'>[]
  keepOut: Entry<'keep_out'>[]
}

function ofKind<K extends BriefEntryDto['kind']>(entries: readonly BriefEntryDto[], kind: K) {
  return entries.filter((entry): entry is Entry<K> => entry.kind === kind)
}

/** Examine starts from the batch; Research and Images from what Examine found. */
function titleOf(brief: SessionBriefDto) {
  return brief.stage === 'examine' ? 'Started from the batch' : 'Started from Examine’s findings'
}

export function briefView(brief: SessionBriefDto): BriefView {
  const { entries } = brief
  const corrections = ofKind(entries, 'correction')
  const observations = ofKind(entries, 'observation').map((entry) => ({
    observation: entry.observation,
    corrections: corrections.filter(
      (correction) => correction.observation_id === entry.observation.id,
    ),
  }))
  const listed = new Set(observations.map((row) => row.observation.id))
  const facts = entries.filter(
    (entry): entry is BriefFact =>
      entry.kind === 'answer' ||
      entry.kind === 'note' ||
      entry.kind === 'setting_note' ||
      entry.kind === 'lot_edit',
  )

  return {
    title: titleOf(brief),
    batch: ofKind(entries, 'batch')[0] ?? null,
    identities: ofKind(entries, 'identity'),
    observations,
    corrections: corrections.filter((entry) => !listed.has(entry.observation_id)),
    facts,
    instructions: ofKind(entries, 'instruction'),
    asked: ofKind(entries, 'question'),
    evidence: ofKind(entries, 'evidence'),
    lots: ofKind(entries, 'lot'),
    parts: ofKind(entries, 'part'),
    keepOut: ofKind(entries, 'keep_out'),
  }
}

function plural(count: number, one: string, many = `${one}s`) {
  return `${count} ${count === 1 ? one : many}`
}

/**
 * How many of the operator's facts the brief holds: every correction, answer, note, edit and
 * saved instruction, as "Your facts" and the observations list them.
 */
export function factCount(view: BriefView) {
  const corrections = view.observations.reduce((sum, row) => sum + row.corrections.length, 0)
  return view.facts.length + view.instructions.length + corrections + view.corrections.length
}

/** The brief's one-line summary, naming only what it holds. */
export function briefSummary(brief: SessionBriefDto) {
  const view = briefView(brief)
  const facts = factCount(view)
  const parts = [
    view.observations.length > 0 ? plural(view.observations.length, 'observation') : null,
    facts > 0 ? `${facts} of your facts` : null,
    view.asked.length > 0 ? `${plural(view.asked.length, 'question')} already asked` : null,
  ]
  return [view.title, ...parts.filter((part) => part !== null)].join(' · ')
}

/**
 * A reading as one line: its markings, then what was read as text, labelled, so moving words
 * between the two reads as a change.
 */
export function readingText(readings: Observation['readings']) {
  const markings = readings.markings.join(' · ')
  if (readings.text === undefined) {
    return markings
  }
  const text = `read as “${readings.text}”`
  return markings ? `${markings} · ${text}` : text
}

type LotEdit = Entry<'lot_edit'>

/** A lot edit's quantity as the operator left it. */
export function quantityWords(quantity: LotEdit['quantity']) {
  switch (quantity.mode) {
    case 'set':
      return `quantity ${quantity.value}`
    case 'inherit':
      return 'quantity from the batch'
    case 'unknown':
      return 'quantity unknown'
    case 'clear':
      return 'quantity cleared'
    case 'unset':
      return 'quantity not set'
  }
}

/** Each fact's own identity, so a list keeps its rows across reads. */
export function factKey(fact: BriefFact) {
  switch (fact.kind) {
    case 'answer':
      return `answer:${fact.answer_id}`
    case 'note':
      return `note:${fact.note_id}`
    case 'setting_note':
      return `setting_note:${fact.scope}:${fact.version}`
    case 'lot_edit':
      return fact.edit_id
  }
}
