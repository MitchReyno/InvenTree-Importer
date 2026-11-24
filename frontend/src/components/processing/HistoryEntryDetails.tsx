import styled from 'styled-components'
import type {
  SessionHistoryDetailsDto,
  SessionHistoryEntryDto,
  SessionHistoryLinkDto,
} from '@invimport/contracts'
import { DebugDetails, EventTime, SourceChip } from '#/components/ui'
import { evidenceWords } from '#/operator/value-evidence'
import { observationCrop } from '#/media/types'
import { color, radius, space, typeVar } from '#/theme/generated/tokens'
import { ProcessingSources } from './ProcessingSources'
import type { HistoryContext } from './HistoryLinks'

type Details<K extends SessionHistoryDetailsDto['kind']> = Extract<
  SessionHistoryDetailsDto,
  { kind: K }
>
type CurrentObservation = NonNullable<Details<'observation'>['current']>

/** The kinds whose details add nothing to their one-line summary. */
const ONE_LINE = new Set<SessionHistoryDetailsDto['kind']>(['status', 'chat', 'reply'])

export function hasDetails(entry: SessionHistoryEntryDto) {
  return !ONE_LINE.has(entry.details.kind)
}

/** The recut of a photo view, served by the session's photo-view crop route. */
export function photoViewCrop(
  context: HistoryContext,
  crop: NonNullable<Details<'photo_view'>['crop']>,
) {
  const path = [
    'api/v1/batches',
    context.batchId,
    'processing/sessions',
    context.jobId,
    'photo-views',
    crop.attempt_id,
    crop.seq,
    'crop',
  ]
  return `/${path.map((part, index) => (index % 2 ? encodeURIComponent(part) : part)).join('/')}`
}

function ObservationReading({
  observation,
  context,
}: {
  observation: CurrentObservation
  context: HistoryContext
}) {
  const said = evidenceWords(observation.readings)
  const reading = observation.readings.text ?? observation.readings.markings.join(' · ')
  return (
    <Observation>
      <Crop
        src={observationCrop(context.batchId, observation.id)}
        alt={`Crop of the observation: ${reading}`}
        loading="lazy"
      />
      <span>
        {reading}{' '}
        <SourceChip
          source={said.kind ? `Examine · ${said.kind}` : 'Examine'}
          certainty={said.certainty ?? 'Read from the photo'}
          tone={said.tone}
          value={reading}
          why="What the agent read in this region."
        />
        {observation.visible_count !== null && ` · ${observation.visible_count} visible`}
      </span>
    </Observation>
  )
}

function lotLabels(links: readonly SessionHistoryLinkDto[]) {
  return new Map(
    links.flatMap((link) => (link.kind === 'lot' ? [[link.lot_id, link.label] as const] : [])),
  )
}

const MOVE_WORDS = { applied: 'Moved', suggested: 'Suggested moving', unchanged: 'Already in' }

function RegroupDetails({
  entry,
  details,
}: {
  entry: SessionHistoryEntryDto
  details: Details<'regroup'>
}) {
  const labels = lotLabels(entry.links)

  const name = (id: string | null) => (id ? (labels.get(id) ?? 'a lot') : 'no lot')

  if (!details.moves) {
    return <p>Moved into {details.lot_ids.map(name).join(', ')}</p>
  }
  return (
    <ul>
      {details.moves.map((move) => (
        <li key={`${move.observation_id}:${move.to_lot_id}`}>
          {move.outcome === 'applied' && move.from_lot_id
            ? `Moved from ${name(move.from_lot_id)} to ${name(move.to_lot_id)}`
            : `${MOVE_WORDS[move.outcome]} into ${name(move.to_lot_id)}`}
        </li>
      ))}
    </ul>
  )
}

function LotDetails({ details, context }: { details: Details<'lot'>; context: HistoryContext }) {
  const { lot } = details
  return (
    <>
      <Current>Current values</Current>
      {lot?.estimate && (
        <p>
          Agent’s estimate: {lot.estimate.quantity} · estimated — {lot.estimate.basis}
        </p>
      )}
      {lot?.selected_quantity.mode === 'set' && (
        <p>Selected quantity: {lot.selected_quantity.value}</p>
      )}
      {lot && lot.observations.length > 0 && (
        <ul>
          {lot.observations.map((observation) => (
            <li key={observation.id}>
              <ObservationReading observation={observation} context={context} />
            </li>
          ))}
        </ul>
      )}
      <p>
        {details.separation_reason
          ? `Kept apart: ${details.separation_reason}`
          : 'Why it is kept apart was not recorded.'}
      </p>
    </>
  )
}

const CURRENTNESS = {
  current: 'Current',
  provisional: 'Provisional until you answer the questions below',
  stale: 'Stale',
}

function ProposalDetails({ details }: { details: Details<'proposal'> }) {
  const { proposal, currentness } = details
  const manufacturer = proposal.catalogue?.manufacturer
  return (
    <>
      <p>{proposal.summary}</p>
      <Current>{CURRENTNESS[currentness.state]}</Current>
      {manufacturer && (
        <p>
          MPN {manufacturer.mpn}{' '}
          <SourceChip
            source="Proposal"
            {...catalogueSaid(manufacturer)}
            field="MPN"
            value={manufacturer.mpn}
            why="The agent’s retained proposal."
          />
        </p>
      )}
      {proposal.catalogue?.parameters.map((parameter) => (
        <p key={parameter.name}>
          {parameter.name}: {parameter.value}{' '}
          <SourceChip
            source="Proposal"
            {...catalogueSaid(parameter)}
            field={parameter.name}
            value={parameter.value}
            why="The agent’s retained proposal."
          />
        </p>
      ))}
      <ProcessingSources proposal={proposal} />
    </>
  )
}

function catalogueSaid(value: Parameters<typeof evidenceWords>[0]) {
  const said = evidenceWords(value)
  return { certainty: said.certainty ?? 'Proposed', tone: said.tone }
}

const QUESTION_STATE = { open: 'Open', answered: 'Answered', superseded: 'Superseded' }

function QuestionDetails({ details }: { details: Details<'question'> }) {
  const steps =
    'steps' in details.question
      ? details.question.steps
      : [{ id: 'only', prompt: details.question.prompt, assumption: details.question.assumption }]
  return (
    <>
      <Current>{QUESTION_STATE[details.state]}</Current>
      <ol>
        {steps.map((step) => (
          <li key={step.id}>
            {step.prompt} <Muted>Assuming {step.assumption} until you answer.</Muted>
          </li>
        ))}
      </ol>
    </>
  )
}

function answerEffectsText(details: Details<'answer'>) {
  const parts = details.effects.map((effect) =>
    effect.kind === 'quantity'
      ? `Lot quantity set to ${effect.value} (${effect.basis})`
      : 'note added',
  )
  const text = parts.join(' · ')
  return text ? text.charAt(0).toUpperCase() + text.slice(1) : 'Nothing changed in Capture.'
}

function PhotoViewDetails({
  details,
  context,
}: {
  details: Details<'photo_view'>
  context: HistoryContext
}) {
  const { view, crop } = details
  return (
    <>
      {crop ? (
        <Crop
          src={photoViewCrop(context, crop)}
          alt="Region sent to the agent, recut from the page"
          loading="lazy"
        />
      ) : (
        <Muted>The photo was removed, so the region can’t be recut.</Muted>
      )}
      <p>
        Sent {view.delivered.width} × {view.delivered.height}
        {view.region
          ? `, region ${view.region.width} × ${view.region.height} at ${view.region.x}, ${view.region.y}`
          : ', the whole page'}
        {view.page > 1 && ` of page ${view.page}`}. Recut from the page, so not the exact bytes
        sent.
      </p>
      <DebugDetails
        label="Photo view"
        rows={[{ label: 'Sent SHA-256', value: view.delivered.sha256 }]}
      />
    </>
  )
}

/** What an entry expands to, by kind; values a record holds now are labelled current. */
export function HistoryEntryDetails({
  entry,
  context,
}: {
  entry: SessionHistoryEntryDto
  context: HistoryContext
}) {
  const { details } = entry
  switch (details.kind) {
    case 'status':
    case 'chat':
    case 'reply':
      return null
    case 'observation':
      return details.current ? (
        <>
          <Current>Current values</Current>
          <ObservationReading observation={details.current} context={context} />
        </>
      ) : (
        <Muted>The observation no longer exists.</Muted>
      )
    case 'lot':
      return <LotDetails details={details} context={context} />
    case 'regroup':
      return <RegroupDetails entry={entry} details={details} />
    case 'proposal':
      return <ProposalDetails details={details} />
    case 'question':
      return <QuestionDetails details={details} />
    case 'answer':
      return <p>{answerEffectsText(details)}</p>
    case 'instruction':
      return (
        <>
          <p>{details.text || 'The instruction was cleared.'}</p>
          <Muted>
            {details.saved_at ? (
              <>
                Saved <EventTime at={details.saved_at} />
              </>
            ) : (
              'When it was saved is no longer retained.'
            )}
            {details.relayed && ' · relayed to a later attempt'}
          </Muted>
        </>
      )
    case 'evidence':
      return (
        <p>
          {details.restored
            ? 'A photo was restored in Capture.'
            : 'A new photo was added in Capture.'}
        </p>
      )
    case 'revision':
      return (
        <p>
          The app told the session about your correction to {details.fields.join(', ')}:{' '}
          {details.reason}
        </p>
      )
    case 'photo_view':
      return <PhotoViewDetails details={details} context={context} />
    case 'web_read':
      return (
        <>
          <p>
            {details.title ?? details.url}
            {details.read_at && (
              <>
                {' '}
                · read <EventTime at={details.read_at} />
              </>
            )}
          </p>
          <Muted>Reported by the agent; no copy is saved, so it is not verified.</Muted>
        </>
      )
  }
}

const Current = styled.span`
  font-size: ${typeVar.label.size};
  font-weight: ${typeVar.label.weight};
  letter-spacing: ${typeVar.label.letterSpacing};
  text-transform: uppercase;
  color: ${color.muted};
`

const Muted = styled.span`
  color: ${color.muted};
`

const Observation = styled.span`
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: ${space[3]};
  overflow-wrap: anywhere;
`

const Crop = styled.img`
  display: block;
  max-width: min(100%, 240px);
  max-height: 160px;
  object-fit: contain;
  border-radius: ${radius.thumb};
  background: ${color.surface2};
`
