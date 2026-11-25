import { useId } from 'react'
import styled from 'styled-components'
import type { BriefEntryDto, SessionHistoryBriefDto } from '@invimport/contracts'
import { EventTime, Pill } from '#/components/ui'
import { briefSummary, briefView, type BriefView } from '#/processing/brief-view'
import { color, radius, space, typeVar } from '#/theme/generated/tokens'
import { BriefFacts } from './BriefFacts'
import { BriefObservations } from './BriefObservations'
import {
  BriefHeading,
  BriefMuted,
  BriefRow,
  BriefRows,
  BriefSection,
  Reading,
} from './brief-styles'
import { HistoryText, HistoryTime } from './history-row-styles'

type Question = Extract<BriefEntryDto, { kind: 'question' }>
type Evidence = Extract<BriefEntryDto, { kind: 'evidence' }>

const ASKED = 'Already asked · not asked again'
const EVIDENCE = 'Evidence it may read itself'

function QuestionState({ state }: { state: Question['state'] }) {
  switch (state) {
    case 'answered':
      return <Pill status="complete">Answered</Pill>
    case 'open':
      return <Pill status="needs-answer">Open</Pill>
    case 'superseded':
      return <Pill tone="neutral">Superseded</Pill>
  }
}

/** A photo or document by its label and kind, with how many regions earlier stages read in it. */
function evidenceText(entry: Evidence) {
  const kind = entry.media_type === 'application/pdf' ? 'PDF' : 'photo'
  const regions = entry.regions.length
  const read = regions === 0 ? '' : ` · ${regions} ${regions === 1 ? 'region' : 'regions'} read`
  return `${entry.label ?? `Unlabelled ${kind}`} (${kind})${read}`
}

/** Examine's identities the session was pinned to, as Examine published them. */
function Identities({ view }: { view: BriefView }) {
  if (view.identities.length === 0) {
    return null
  }
  return (
    <BriefSection>
      <BriefHeading>Examine’s identity</BriefHeading>
      <BriefRows aria-label="Examine’s identity">
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

/** The lead's lots and Parts, and for Images the items to keep out of frame. */
function StageLists({ view }: { view: BriefView }) {
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
                  Page {item.page}: <Reading>{item.markings.join(' · ')}</Reading>
                </span>
              </BriefRow>
            ))}
          </BriefRows>
        </BriefSection>
      )}
    </>
  )
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
      <Identities view={view} />
      <BriefObservations
        rows={view.observations}
        corrections={view.corrections}
        evidenceLabel={label}
      />
      <BriefFacts view={view} lotId={brief.lot_id} />
      <StageLists view={view} />
      {view.asked.length > 0 && (
        <BriefSection>
          <BriefHeading>{ASKED}</BriefHeading>
          <BriefRows aria-label={ASKED}>
            {view.asked.map((question) => (
              <BriefRow key={question.question_id}>
                <span>
                  {question.title}
                  {question.fields.length > 0 && (
                    <BriefMuted> · {question.fields.join(', ')}</BriefMuted>
                  )}
                </span>
                <QuestionState state={question.state} />
              </BriefRow>
            ))}
          </BriefRows>
        </BriefSection>
      )}
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
    gap: ${space[1]} ${space[3]};
    padding: ${space[3]} ${space[4]};
    cursor: pointer;
    font-weight: ${typeVar.bodyStrong.weight};
  }
`
