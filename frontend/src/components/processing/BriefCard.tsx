import { useId } from 'react'
import styled from 'styled-components'
import type { BriefEntryDto, SessionHistoryBriefDto } from '@invimport/contracts'
import { EventTime } from '#/components/ui'
import { briefSummary, briefView } from '#/processing/brief-view'
import { color, radius, space, typeVar } from '#/theme/generated/tokens'
import { BriefAsked } from './BriefAsked'
import { BriefFacts } from './BriefFacts'
import { BriefIdentities } from './BriefIdentities'
import { BriefObservations } from './BriefObservations'
import { BriefStageLists } from './BriefStageLists'
import { BriefHeading, BriefMuted, BriefRow, BriefRows, BriefSection } from './brief-styles'
import { HistoryText, HistoryTime } from './history-row-styles'

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
 * The brief a `/7` attempt started from, as the first item after its divider: a collapsed
 * summary that opens to what Examine found, the operator's facts with their corrections marked
 * as theirs, the questions already asked and the evidence the session may read.
 */
export function BriefCard({ item }: { item: SessionHistoryBriefDto }) {
  const summaryId = useId()
  const { brief } = item
  const view = briefView(brief)

  const label = (versionId: string) =>
    view.evidence.find((entry) => entry.version_id === versionId)?.label ?? 'A photo'

  return (
    <Card id={`brief:${item.attempt_id}`} aria-labelledby={summaryId}>
      <summary id={summaryId}>
        <HistoryText>{briefSummary(brief)}</HistoryText>
        <HistoryTime>
          <EventTime at={item.at} />
        </HistoryTime>
      </summary>
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
      <BriefStageLists view={view} />
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
    </Card>
  )
}

const Card = styled.details`
  min-width: 0;
  border: 1px solid ${color.lineStrong};
  border-radius: ${radius.card};
  background: ${color.surface};
  overflow-wrap: anywhere;
  > summary {
    display: flex;
    flex-wrap: wrap;
    align-items: baseline;
    gap: ${space[1]} ${space[3]};
    padding: ${space[3]} ${space[4]};
    cursor: pointer;
    font-weight: ${typeVar.bodyStrong.weight};
  }
  /* The flex summary drops the native marker, so the card draws its own. */
  > summary::before {
    content: '▸';
    color: ${color.muted};
  }
  &[open] > summary::before {
    content: '▾';
  }
`
