import type { BriefView } from '#/processing/brief-view'
import { BriefHeading, BriefMuted, BriefRow, BriefRows, BriefSection } from './brief-styles'

const HEADING = 'Examine’s identity'

/** Examine's identities the session was pinned to, as Examine published them. */
export function BriefIdentities({ view }: { view: BriefView }) {
  if (view.identities.length === 0) {
    return null
  }
  return (
    <BriefSection>
      <BriefHeading>{HEADING}</BriefHeading>
      <BriefRows aria-label={HEADING}>
        {view.identities.map((entry) => (
          <BriefRow key={entry.proposal_id}>
            <span>
              <b>{entry.proposal.summary}</b>
              {entry.stale && <BriefMuted> · stale</BriefMuted>}
            </span>
          </BriefRow>
        ))}
      </BriefRows>
    </BriefSection>
  )
}
