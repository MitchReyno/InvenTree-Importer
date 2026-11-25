import { factKey, type BriefView } from '#/processing/brief-view'
import { BriefFactRow } from './BriefFactRow'
import { BriefHeading, BriefMuted, BriefRow, BriefRows, BriefSection, Yours } from './brief-styles'

const HEADING = 'Your facts'

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
          <BriefFactRow key={factKey(fact)} fact={fact} view={view} lotId={lotId} />
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
