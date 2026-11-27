import type {
  BriefEntryDto,
  SessionBriefDto,
  SessionHistoryBriefRefDto,
} from '@invimport/contracts'

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
  batch: Entry<'batch'> | null
  /** The operator's instructions for this step, as the attempt was queued with them. */
  stepGuidance: Entry<'step_guidance'> | null
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
  /** Match's state for the lot, or for every lot in Examine's brief. */
  matches: Entry<'match'>[]
}

function ofKind<K extends BriefEntryDto['kind']>(entries: readonly BriefEntryDto[], kind: K) {
  return entries.filter((entry): entry is Entry<K> => entry.kind === kind)
}

export function briefView(brief: SessionBriefDto): BriefView {
  const { entries } = brief
  const corrections = ofKind(entries, 'correction')
  const correctionsOf = new Map<string, Entry<'correction'>[]>()
  for (const correction of corrections) {
    const listed = correctionsOf.get(correction.observation_id) ?? []
    correctionsOf.set(correction.observation_id, [...listed, correction])
  }
  const observations = ofKind(entries, 'observation').map((entry) => ({
    observation: entry.observation,
    corrections: correctionsOf.get(entry.observation.id) ?? [],
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
    batch: ofKind(entries, 'batch')[0] ?? null,
    stepGuidance: ofKind(entries, 'step_guidance')[0] ?? null,
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
    matches: ofKind(entries, 'match'),
  }
}

function plural(count: number, one: string, many = `${one}s`) {
  return `${count} ${count === 1 ? one : many}`
}

/**
 * The collapsed line of a brief: what the session started from, with the counts its brief was
 * sealed with. They describe the brief at the start, not the batch now.
 */
export function briefRefSummary(ref: SessionHistoryBriefRefDto) {
  const count = (name: SessionHistoryBriefRefDto['sections'][number]['name']) =>
    ref.sections.find((section) => section.name === name)?.count ?? 0

  const observations = count('observations')
  const facts = count('human')
  const asked = count('asked')
  const parts = [
    observations > 0 ? plural(observations, 'observation') : null,
    facts > 0 ? `${facts} of your facts` : null,
    asked > 0 ? `${plural(asked, 'question')} already asked` : null,
  ]
  const from = ref.stage === 'examine' ? 'the batch' : 'Examine’s findings'
  return ['Brief at start', from, ...parts.filter((part) => part !== null)].join(' · ')
}

/**
 * A reading as one line: its markings, then what was read as text, labelled, so moving words
 * between the two reads as a change.
 */
export function readingText(readings: Observation['readings']) {
  const markings = readings.markings.join(' · ')
  if (readings.text === undefined) {
    return markings || 'no markings or text'
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

type Region = Entry<'keep_out'>['region']

/** Where on its page a region is, in the units it was recorded in. */
export function regionWords(region: Region) {
  if (region.kind === 'lines') {
    return `lines ${region.from_line}–${region.to_line}`
  }
  return `${region.width}×${region.height} px at ${region.x}, ${region.y}`
}

/** The id of a brief's summary, the control that opens it. */
export function briefSummaryId(attemptId: string) {
  return `brief-summary:${attemptId}`
}
