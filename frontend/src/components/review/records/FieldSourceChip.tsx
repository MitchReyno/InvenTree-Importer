import type { RecordFieldDto, RecordOriginDto } from '@invimport/contracts'
import { SourceChip } from '#/components/ui'
import { STEP_LABELS } from '#/records/model'
import { evidenceWords } from '#/operator/value-evidence'

type StepOrigin = Extract<RecordOriginDto, { kind: 'step' }>

/** A step's value in words: what it came from and how well its sources agree, when it said. */
function stepSource(origin: Exclude<RecordOriginDto, { kind: 'operator' }>) {
  const step = STEP_LABELS[origin.step]
  if (origin.kind === 'estimate') {
    return {
      source: step,
      certainty: 'Estimated',
      tone: 'likely' as const,
      why: `${step}’s estimate; accept or replace it on the lot.`,
    }
  }
  const said = evidenceWords(origin)

  return {
    source: said.kind ? `${step} · ${said.kind}` : step,
    certainty: said.certainty ?? 'Proposed',
    tone: said.tone,
    why: origin.chosen_because ?? `Proposed by the ${step} step.`,
    evidence: otherValues(origin),
  }
}

/** The other values the step's sources gave, so the popover says where else a value appears. */
function otherValues(origin: StepOrigin) {
  if (!origin.alternatives?.length) {
    return undefined
  }
  const values = origin.alternatives.map((other) => {
    const kind = evidenceWords(other).kind

    return kind ? `${other.value} (${kind})` : other.value
  })

  return `Other sources say ${values.join(', ')}.`
}

/** Who set a record's field, as a short chip whose details give the value and why. */
export function FieldSourceChip({ label, field }: { label: string; field: RecordFieldDto }) {
  const value = field.value ?? '—'
  if (field.origin.kind === 'operator') {
    return (
      <SourceChip
        source="You"
        certainty="Your edit"
        tone="user"
        field={label}
        value={value}
        why="You set this value."
      />
    )
  }

  return <SourceChip {...stepSource(field.origin)} field={label} value={value} />
}
