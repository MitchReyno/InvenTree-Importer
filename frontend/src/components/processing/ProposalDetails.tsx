import type { ReactNode } from 'react'
import type {
  SessionHistoryDetailsDto,
  SessionHistoryEntryDto,
  SessionHistoryLinkDto,
  SourceAgreementDto,
  SourceKindDto,
} from '@invimport/contracts'
import { KeyValue, SourceChip, type KeyValueRow } from '#/components/ui'
import { evidenceWords } from '#/operator/value-evidence'
import { DetailLabel, DetailList } from './history-styles'
import { HistoryLink, type HistoryContext } from './HistoryLink'
import { ProcessingSources } from './ProcessingSources'

type Details = Extract<SessionHistoryDetailsDto, { kind: 'proposal' }>
type Reliance = Details['proposal']['relies_on']['sources'][number]
/** A retained catalogue value: its sources and how well they agreed. */
type SaidValue = {
  sources: readonly Reliance[]
  source_kind?: SourceKindDto
  agreement?: SourceAgreementDto
}

const CURRENTNESS = {
  current: 'Current',
  provisional: 'Provisional until you answer the questions it relies on',
  stale: 'Stale',
}

const RELIANCE_WORDS: Record<Reliance['kind'], string> = {
  note: 'a note',
  media_version: 'a photo',
  evidence_observation: 'an observation',
  observation_set: 'the lot’s observations',
  inbox_item: 'one of your inputs',
  proposal: 'another proposal',
}

/** A catalogue choice of a company or category: a new one by name, or an existing record. */
type Choice =
  { choice: 'proposed_new'; name: string } | { choice: 'existing'; reference: { pk: string } }

/** A new choice by its name; an existing one by its InvenTree record, since only its pk is kept. */
function choiceName(choice: Choice, model: 'company' | 'category') {
  if (choice.choice === 'proposed_new') {
    return `${choice.name} (new)`
  }
  return `Existing InvenTree ${model} #${choice.reference.pk}`
}

/** The entry's own link to a cited photo or note, or the source in words where it has none. */
function sourceView(
  source: Reliance,
  links: readonly SessionHistoryLinkDto[],
  context: HistoryContext,
) {
  const link = links.find(
    (candidate) =>
      (source.kind === 'media_version' &&
        candidate.kind === 'capture_evidence' &&
        candidate.version_id === source.version_id) ||
      (source.kind === 'note' && candidate.kind === 'note' && candidate.note_id === source.note_id),
  )
  return link ? <HistoryLink link={link} context={context} /> : RELIANCE_WORDS[source.kind]
}

function sourceList(
  sources: readonly Reliance[],
  links: readonly SessionHistoryLinkDto[],
  context: HistoryContext,
): ReactNode {
  return (
    <DetailList>
      {sources.map((source, index) => (
        <li key={index}>{sourceView(source, links, context)}</li>
      ))}
    </DetailList>
  )
}

/**
 * A proposal as retained: its summary and currentness, each structured value with a source chip
 * that lists its own sources, what it relies on, and its top-level sources (a web page among them
 * marked agent-reported).
 */
export function ProposalDetails({
  entry,
  details,
  context,
}: {
  entry: SessionHistoryEntryDto
  details: Details
  context: HistoryContext
}) {
  const { proposal, currentness } = details
  const catalogue = proposal.catalogue

  const row = (label: string, value: string, said: SaidValue): KeyValueRow => {
    const words = evidenceWords(said)
    return {
      label,
      value,
      state: 'plain',
      source: (
        <SourceChip
          source={words.kind ? `Agent · ${words.kind}` : 'Agent'}
          certainty={words.certainty ?? 'Proposed'}
          tone={words.tone}
          field={label}
          value={value}
          why="The value as the agent's proposal retained it."
          evidence={sourceList(said.sources, entry.links, context)}
        />
      ),
    }
  }

  const rows: KeyValueRow[] = []
  if (catalogue?.manufacturer) {
    const { company, mpn } = catalogue.manufacturer
    rows.push(
      row('Manufacturer', choiceName(company, 'company'), company),
      row('MPN', mpn, catalogue.manufacturer),
    )
  }
  if (catalogue?.category) {
    rows.push(row('Category', choiceName(catalogue.category, 'category'), catalogue.category))
  }
  if (catalogue?.description) {
    rows.push(row('Description', catalogue.description.text, catalogue.description))
  }
  for (const parameter of catalogue?.parameters ?? []) {
    rows.push(row(parameter.name, parameter.value, parameter))
  }

  return (
    <>
      <p>{proposal.summary}</p>
      <DetailLabel>{CURRENTNESS[currentness.state]}</DetailLabel>
      {rows.length > 0 && <KeyValue rows={rows} />}
      <p>Relies on {proposal.relies_on.fields.join(', ')}, from:</p>
      {sourceList(proposal.relies_on.sources, entry.links, context)}
      <ProcessingSources proposal={proposal} />
    </>
  )
}
