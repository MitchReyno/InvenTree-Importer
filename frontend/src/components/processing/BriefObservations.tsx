import type { BriefEntryDto } from '@invimport/contracts'
import { EventTime } from '#/components/ui'
import { readingText, type BriefObservationRow } from '#/processing/brief-view'
import {
  BriefHeading,
  BriefMuted,
  BriefRow,
  BriefRows,
  BriefSection,
  Reading,
  Was,
  Yours,
} from './brief-styles'

type Correction = Extract<BriefEntryDto, { kind: 'correction' }>

const HEADING = 'Observations'

/** "✎ Your correction" with when it was made, or that the earlier reading wasn't kept. */
function CorrectionMark({ correction }: { correction: Correction }) {
  return (
    <Yours>
      <span aria-hidden="true">✎</span> Your correction
      {correction.corrected_at && (
        <>
          {' · '}
          <EventTime at={correction.corrected_at} />
        </>
      )}
    </Yours>
  )
}

/** The reading the session was given, after the earlier one struck through where it was kept. */
function CorrectedReading({ correction }: { correction: Correction }) {
  return (
    <>
      {correction.before ? (
        <>
          <Was>{readingText(correction.before)}</Was>{' '}
        </>
      ) : (
        <BriefMuted>Earlier reading not kept · </BriefMuted>
      )}
      <Reading>{readingText(correction.after)}</Reading>
    </>
  )
}

/**
 * The observations the brief gave the session, each with where it was read and how many were
 * visible, and the operator's corrections marked as theirs.
 */
export function BriefObservations({
  rows,
  corrections,
  evidenceLabel,
}: {
  rows: readonly BriefObservationRow[]
  /** Corrections to observations the brief doesn't list. */
  corrections: readonly Correction[]
  evidenceLabel: (versionId: string) => string
}) {
  if (rows.length === 0 && corrections.length === 0) {
    return null
  }
  return (
    <BriefSection>
      <BriefHeading>{HEADING}</BriefHeading>
      <BriefRows aria-label={HEADING}>
        {rows.map(({ observation, correction }) => (
          <BriefRow key={observation.id}>
            <span>
              {evidenceLabel(observation.evidence_version_id)}, page {observation.page}
              {observation.visible_count !== null && ` · ${observation.visible_count} visible`}
              {': '}
              {correction ? (
                <CorrectedReading correction={correction} />
              ) : (
                <Reading>{readingText(observation.readings)}</Reading>
              )}
            </span>
            {correction && <CorrectionMark correction={correction} />}
          </BriefRow>
        ))}
        {corrections.map((correction) => (
          <BriefRow key={correction.observation_id}>
            <span>
              <CorrectedReading correction={correction} />
            </span>
            <CorrectionMark correction={correction} />
          </BriefRow>
        ))}
      </BriefRows>
    </BriefSection>
  )
}
