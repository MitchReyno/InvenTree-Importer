import type { BriefEntryDto } from '@invimport/contracts'
import { EventTime } from '#/components/ui'
import { readingText } from '#/processing/brief-view'
import { BriefMuted, BriefRow, Reading, Was, Yours } from './brief-styles'

type Correction = Extract<BriefEntryDto, { kind: 'correction' }>

/**
 * One correction the operator made to a reading: the earlier reading struck through where it was
 * kept, the reading it became, and "✎ Your correction" with when it was made.
 */
export function BriefCorrection({ correction }: { correction: Correction }) {
  return (
    <BriefRow>
      <span>
        {correction.before ? (
          <>
            <Was>{readingText(correction.before)}</Was> →{' '}
          </>
        ) : (
          <BriefMuted>Earlier reading not kept → </BriefMuted>
        )}
        <Reading>{readingText(correction.after)}</Reading>
      </span>
      <Yours>
        <span aria-hidden="true">✎</span> Your correction
        {correction.corrected_at && (
          <>
            {' · '}
            <EventTime at={correction.corrected_at} />
          </>
        )}
      </Yours>
    </BriefRow>
  )
}
