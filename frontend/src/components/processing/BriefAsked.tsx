import type { BriefEntryDto } from '@invimport/contracts'
import { Pill } from '#/components/ui'
import { BriefHeading, BriefMuted, BriefRow, BriefRows, BriefSection } from './brief-styles'

type Question = Extract<BriefEntryDto, { kind: 'question' }>

const HEADING = 'Already asked · not asked again'

/** How each question's state reads, with the design system's status for it. */
const STATE = {
  answered: { status: 'complete', words: 'Answered' },
  open: { status: 'needs-answer', words: 'Open' },
  superseded: { status: 'excluded', words: 'Superseded' },
} as const satisfies Record<Question['state'], { status: string; words: string }>

/** The questions already asked about the subject, with the fields each is about and its state. */
export function BriefAsked({ asked }: { asked: readonly Question[] }) {
  if (asked.length === 0) {
    return null
  }
  return (
    <BriefSection>
      <BriefHeading>{HEADING}</BriefHeading>
      <BriefRows aria-label={HEADING}>
        {asked.map((question) => (
          <BriefRow key={question.question_id}>
            <span>
              {question.title}
              {question.fields.length > 0 && (
                <BriefMuted> · {question.fields.join(', ')}</BriefMuted>
              )}
            </span>
            <Pill status={STATE[question.state].status}>{STATE[question.state].words}</Pill>
          </BriefRow>
        ))}
      </BriefRows>
    </BriefSection>
  )
}
