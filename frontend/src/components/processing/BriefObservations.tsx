import styled from 'styled-components'
import type { BriefEntryDto } from '@invimport/contracts'
import { readingText, type BriefObservationRow } from '#/processing/brief-view'
import { BriefCorrection } from './BriefCorrection'
import { space } from '#/theme/generated/tokens'
import { BriefHeading, BriefRow, BriefRows, BriefSection, Reading } from './brief-styles'

type Correction = Extract<BriefEntryDto, { kind: 'correction' }>

const HEADING = 'Observations'

/**
 * The observations the brief gave the session, each with where it was read and how many were
 * visible, and below it each of the operator's corrections to it, marked as theirs.
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
        {rows.map(({ observation, corrections: own }) => (
          <BriefRow key={observation.id}>
            <span>
              {evidenceLabel(observation.evidence_version_id)}, page {observation.page}
              {observation.visible_count !== null && ` · ${observation.visible_count} visible`}
              {': '}
              <Reading>{readingText(observation.readings)}</Reading>
            </span>
            {own.length > 0 && (
              <Nested aria-label="Your corrections">
                {own.map((correction) => (
                  <BriefCorrection key={correction.revision ?? 'earlier'} correction={correction} />
                ))}
              </Nested>
            )}
          </BriefRow>
        ))}
        {corrections.map((correction) => (
          <BriefCorrection
            key={`${correction.observation_id}:${correction.revision ?? 'earlier'}`}
            correction={correction}
          />
        ))}
      </BriefRows>
    </BriefSection>
  )
}

/** Corrections sit on their own lines under the reading they changed. */
const Nested = styled(BriefRows)`
  flex-basis: 100%;
  padding-left: ${space[4]};
`
