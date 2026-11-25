import type { BriefEntryDto, SessionHistoryBriefDto } from '@invimport/contracts'
import { briefView } from '#/processing/brief-view'
import { BriefAsked } from './BriefAsked'
import { BriefFacts } from './BriefFacts'
import { BriefIdentities } from './BriefIdentities'
import { BriefObservations } from './BriefObservations'
import { BriefStageLists } from './BriefStageLists'
import { BriefHeading, BriefMuted, BriefRow, BriefRows, BriefSection } from './brief-styles'

type Evidence = Extract<BriefEntryDto, { kind: 'evidence' }>

const EVIDENCE = 'Evidence it may read itself'

/** A photo or document by its label and kind, with how many regions earlier stages read in it. */
function evidenceText(entry: Evidence) {
  const kind = entry.media_type === 'application/pdf' ? 'PDF' : 'photo'
  const regions = entry.regions.length
  const read = regions === 0 ? '' : ` · ${regions} ${regions === 1 ? 'region' : 'regions'} read`
  return `${entry.label ?? `Unlabelled ${kind}`} (${kind})${read}`
}

/**
 * What an opened brief shows: what Examine found, the operator's facts with their corrections
 * marked as theirs, the questions already asked and the evidence the session may read.
 */
export function BriefContent({ item }: { item: SessionHistoryBriefDto }) {
  const { brief } = item
  const view = briefView(brief)

  const label = (versionId: string) =>
    view.evidence.find((entry) => entry.version_id === versionId)?.label ?? 'A photo'

  return (
    <>
      {view.batch && (
        <BriefSection>
          <BriefMuted>
            Batch “{view.batch.title}” · public web pages{' '}
            {view.batch.web.public_pages ? 'allowed' : 'off'}
          </BriefMuted>
        </BriefSection>
      )}
      <BriefIdentities view={view} />
      <BriefObservations
        rows={view.observations}
        corrections={view.corrections}
        evidenceLabel={label}
      />
      <BriefFacts view={view} lotId={brief.lot_id} />
      <BriefStageLists view={view} evidenceLabel={label} />
      <BriefAsked asked={view.asked} />
      {view.evidence.length > 0 && (
        <BriefSection>
          <BriefHeading>{EVIDENCE}</BriefHeading>
          <BriefRows aria-label={EVIDENCE}>
            {view.evidence.map((entry) => (
              <BriefRow key={entry.version_id}>
                <span>{evidenceText(entry)}</span>
              </BriefRow>
            ))}
          </BriefRows>
        </BriefSection>
      )}
    </>
  )
}
