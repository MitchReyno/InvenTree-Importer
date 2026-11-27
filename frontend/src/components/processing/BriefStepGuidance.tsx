import type { BriefStageDto } from '@invimport/contracts'
import type { BriefView } from '#/processing/brief-view'
import { BriefHeading, BriefRow, BriefRows, BriefSection, Yours } from './brief-styles'

const HEADING = 'Operator guidance for this step'

const STEP: Record<BriefStageDto, string> = {
  examine: 'Examine',
  research: 'Research',
  images: 'Images',
}

/** The step instructions the attempt was queued with, marked as the operator's. */
export function BriefStepGuidance({ guidance }: { guidance: BriefView['stepGuidance'] }) {
  if (!guidance) {
    return null
  }
  return (
    <BriefSection>
      <BriefHeading>{HEADING}</BriefHeading>
      <BriefRows aria-label={HEADING}>
        <BriefRow>
          <span>
            <Yours>{STEP[guidance.stage]} instructions</Yours> {guidance.text}
          </span>
        </BriefRow>
      </BriefRows>
    </BriefSection>
  )
}
