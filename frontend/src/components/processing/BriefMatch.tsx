import type { BriefView } from '#/processing/brief-view'
import { keyText, lotResult, lotRuns } from '#/processing/match-view'
import {
  BriefHeading,
  BriefMuted,
  BriefRow,
  BriefRows,
  BriefSection,
  Reading,
} from './brief-styles'

const MATCH = 'Match'

/**
 * What Match had for each lot when the session started: what it searched by, its result and what
 * runs in which mode. The brief carries no questions, so a question reads by its candidates.
 */
export function BriefMatch({ view, lotId }: { view: BriefView; lotId: string | null }) {
  if (view.matches.length === 0) {
    return null
  }

  const label = (id: string) =>
    view.lots.find((lot) => lot.lot_id === id)?.label ?? (id === lotId ? 'This lot' : 'A lot')

  return (
    <BriefSection>
      <BriefHeading>{MATCH}</BriefHeading>
      <BriefRows aria-label={MATCH}>
        {view.matches.map(({ match }) => {
          const runs = lotRuns(match, undefined)
          const keys = match.keys.map(keyText).join(', ')
          return (
            <BriefRow key={match.lot_id}>
              <span>
                {label(match.lot_id)} · {lotResult(match, undefined).text}
                {keys && (
                  <>
                    {' · '}
                    <Reading>{keys}</Reading>
                  </>
                )}
              </span>
              {runs && <BriefMuted>{runs}</BriefMuted>}
            </BriefRow>
          )
        })}
      </BriefRows>
    </BriefSection>
  )
}
