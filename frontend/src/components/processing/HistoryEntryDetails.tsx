import type { SessionHistoryDetailsDto, SessionHistoryEntryDto } from '@invimport/contracts'
import { Button, EventTime } from '#/components/ui'
import { answerEffectsText } from '#/processing/question-summary'
import { DetailLabel, Muted } from './history-styles'
import type { HistoryContext } from './HistoryLink'
import { LotDetails } from './LotDetails'
import { ObservationReading } from './ObservationReading'
import { PhotoViewDetails } from './PhotoViewDetails'
import { ProposalDetails } from './ProposalDetails'
import { QuestionDetails } from './QuestionDetails'
import { RegroupDetails } from './RegroupDetails'

/** The kinds whose details add nothing to their one-line summary. */
const ONE_LINE = new Set<SessionHistoryDetailsDto['kind']>(['status', 'chat', 'reply'])

export function hasDetails(entry: SessionHistoryEntryDto) {
  return !ONE_LINE.has(entry.details.kind)
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
          <DetailLabel>Current values</DetailLabel>
          <ObservationReading observation={details.current} batchId={context.batchId} />
        </>
      ) : (
        <Muted>The observation no longer exists.</Muted>
      )
    case 'lot':
      return <LotDetails details={details} batchId={context.batchId} />
    case 'regroup':
      return <RegroupDetails entry={entry} details={details} context={context} />
    case 'proposal':
      return <ProposalDetails entry={entry} details={details} context={context} />
    case 'question':
      return <QuestionDetails details={details} />
    case 'answer':
      return <p>{answerEffectsText(details.effects) || "Nothing changed in Capture."}</p>
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
          {context.showEntry && (
            <Button
              size="sm"
              variant="link"
              onClick={() => context.showEntry?.(details.proposal_entry_id)}
            >
              Show the proposal that cites it
            </Button>
          )}
        </>
      )
  }
}
