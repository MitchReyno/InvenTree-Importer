import { regionWords, type BriefView } from '#/processing/brief-view'
import {
  BriefHeading,
  BriefMuted,
  BriefRow,
  BriefRows,
  BriefSection,
  Reading,
} from './brief-styles'

/** The lead's lots and Parts, and for Images the items to keep out of frame. */
export function BriefStageLists({
  view,
  evidenceLabel,
}: {
  view: BriefView
  evidenceLabel: (versionId: string) => string
}) {
  return (
    <>
      {view.lots.length > 0 && (
        <BriefSection>
          <BriefHeading>Lots</BriefHeading>
          <BriefRows aria-label="Lots">
            {view.lots.map((lot) => (
              <BriefRow key={lot.lot_id}>
                <span>
                  {lot.label}
                  {lot.estimated_quantity !== null && ` · about ${lot.estimated_quantity}`}
                  {lot.excluded && ' · left out of the batch'}
                </span>
                {lot.reexamine && <BriefMuted>to look at again</BriefMuted>}
              </BriefRow>
            ))}
          </BriefRows>
        </BriefSection>
      )}
      {view.parts.length > 0 && (
        <BriefSection>
          <BriefHeading>Parts</BriefHeading>
          <BriefRows aria-label="Parts">
            {view.parts.map((part) => (
              <BriefRow key={part.part_subject_id}>
                <span>{part.label}</span>
              </BriefRow>
            ))}
          </BriefRows>
        </BriefSection>
      )}
      {view.keepOut.length > 0 && (
        <BriefSection>
          <BriefHeading>Keep out of frame</BriefHeading>
          <BriefRows aria-label="Keep out of frame">
            {view.keepOut.map((item) => (
              <BriefRow key={item.observation_id}>
                <span>
                  {evidenceLabel(item.evidence_version_id)}, page {item.page}:{' '}
                  {item.markings.length > 0 ? (
                    <Reading>{item.markings.join(' · ')}</Reading>
                  ) : (
                    'an unmarked item'
                  )}
                </span>
                <BriefMuted>{regionWords(item.region)}</BriefMuted>
              </BriefRow>
            ))}
          </BriefRows>
        </BriefSection>
      )}
    </>
  )
}
