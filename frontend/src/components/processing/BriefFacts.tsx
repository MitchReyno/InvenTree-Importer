import { EventTime } from '#/components/ui'
import type { BriefFact, BriefView } from '#/processing/brief-view'
import { BriefHeading, BriefMuted, BriefRow, BriefRows, BriefSection, Yours } from './brief-styles'

const HEADING = 'Your facts'

type Note = Extract<BriefFact, { kind: 'note' }>

/** What a note is about, in words, from the labels the brief itself carries. */
function noteAbout(note: Note, view: BriefView, lotId: string | null) {
  if (note.evidence_id !== null) {
    const photo = view.evidence.find((entry) => entry.evidence_id === note.evidence_id)
    return photo?.label ?? 'a photo'
  }
  if (note.group_id !== null) {
    return 'a group of photos'
  }
  if (note.subject_id === null) {
    return 'the batch'
  }
  if (note.subject_id === lotId) {
    return 'this lot'
  }
  const lot = view.lots.find((entry) => entry.lot_id === note.subject_id)
  const part = view.parts.find((entry) => entry.part_subject_id === note.subject_id)
  return lot?.label ?? part?.label ?? 'its Part'
}

/** Each fact's own identity, so a list keeps its rows across reads. */
function factKey(fact: BriefFact) {
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

function Fact({ fact, view, lotId }: { fact: BriefFact; view: BriefView; lotId: string | null }) {
  switch (fact.kind) {
    case 'answer':
      return (
        <BriefRow>
          <span>
            <Yours>Answer</Yours>{' '}
            {fact.steps.map((step, index) => (
              <span key={step.step_id ?? index}>
                {index > 0 && ' · '}
                {step.prompt} → <b>{step.value}</b>
              </span>
            ))}
          </span>
          <BriefMuted>
            <EventTime at={fact.answered_at} />
          </BriefMuted>
        </BriefRow>
      )
    case 'note':
      return (
        <BriefRow>
          <span>
            <Yours>Note</Yours> {fact.text}
          </span>
          <BriefMuted>about {noteAbout(fact, view, lotId)}</BriefMuted>
        </BriefRow>
      )
    case 'setting_note':
      return (
        <BriefRow>
          <span>
            <Yours>{fact.scope === 'batch' ? 'Batch note' : 'Order note'}</Yours> {fact.text}
          </span>
          <BriefMuted>
            <EventTime at={fact.created_at} />
          </BriefMuted>
        </BriefRow>
      )
    case 'lot_edit':
      return (
        <BriefRow>
          <span>
            <Yours>Lot edit</Yours> {fact.label}
            {fact.excluded && ' · left out of the batch'}
          </span>
        </BriefRow>
      )
  }
}

/** The operator's answers, notes and lot edits, and their saved instructions, marked as theirs. */
export function BriefFacts({ view, lotId }: { view: BriefView; lotId: string | null }) {
  const { facts, instructions } = view
  if (facts.length === 0 && instructions.length === 0) {
    return null
  }
  return (
    <BriefSection>
      <BriefHeading>{HEADING}</BriefHeading>
      <BriefRows aria-label={HEADING}>
        {facts.map((fact) => (
          <Fact key={factKey(fact)} fact={fact} view={view} lotId={lotId} />
        ))}
        {instructions.map((instruction) => (
          <BriefRow key={instruction.instruction_id}>
            <span>
              <Yours>Instruction</Yours> {instruction.text}
            </span>
            <BriefMuted>
              {instruction.group_id ? 'for a group of photos' : 'for the batch'}
            </BriefMuted>
          </BriefRow>
        ))}
      </BriefRows>
    </BriefSection>
  )
}
