import { HeadingRow, Caption } from '../ui/primitives'
import { Button, Heading, Panel, Paragraph, Small, Subheading, Summary } from '../ui/primitives'
import type { Snapshot } from '../../capture/types'
import { display } from '../../capture/display'
import styled from 'styled-components'
import type { MediaClient } from '../../media/types'
import { MediaWorkspace } from '../media/MediaWorkspace'
import { HumanNote } from './HumanNote'

type Props = {
  batch: Snapshot
  media?: MediaClient
  onMediaDirtyChange: (dirty: boolean) => void
  selected: string
  dirty: boolean
  frozen: boolean
  setSelected: (value: string) => void
}

export function EvidencePanel({
  batch,
  selected,
  dirty,
  frozen,
  setSelected,
  media,
  onMediaDirtyChange,
}: Props) {
  const lot = batch.lots.find((l) => l.id === selected)
  const part = batch.parts.find((p) => p.id === selected)
  const sharedPart = part ?? batch.parts.find((p) => p.id === lot?.part_subject_id)
  const relatedLots = sharedPart
    ? batch.lots.filter((l) => l.part_subject_id === sharedPart.id)
    : []
  const notes = batch.notes.filter(
    (n) =>
      (!lot && !part) ||
      n.subject_id === null ||
      n.subject_id === selected ||
      n.subject_id === sharedPart?.id,
  )
  const latestNote = notes.at(-1)
  return (
    <EvidenceArea data-area="context" aria-labelledby="evidence">
      <HeadingRow>
        <Heading id="evidence">Human note evidence</Heading>
        <Button disabled={dirty || frozen} onClick={() => setSelected('note')}>
          Add note
        </Button>
      </HeadingRow>
      <Caption>
        Original observations are retained. A note is evidence, not an inferred or approved
        inventory fact.
      </Caption>
      {lot && (
        <ContextCard>
          <Subheading>{lot.label}</Subheading>
          <Facts>
            <dt>Quantity</dt>
            <dd>{display(lot.quantity, batch, 'quantity')}</dd>
            <dt>Location</dt>
            <dd>
              {lot.location.mode === 'inherit' ? '' : 'Override · '}
              {display(lot.location, batch, 'location')}
            </dd>
            <dt>Shared Part</dt>
            <dd>{sharedPart?.label ?? 'Not linked yet'}</dd>
          </Facts>
        </ContextCard>
      )}
      {sharedPart && (
        <ContextCard>
          <Subheading>{sharedPart.label}</Subheading>
          <Paragraph>{display(sharedPart.choice, batch, 'location')}</Paragraph>
          <Small>
            Shared Part · {relatedLots.length} lots. Quantities belong to each physical lot.
          </Small>
        </ContextCard>
      )}
      {latestNote && <HumanNote note={latestNote} batch={batch} />}
      {notes.length > 1 && (
        <details>
          <Summary>Earlier human notes · {notes.length - 1}</Summary>
          {notes.slice(0, -1).map((n) => (
            <HumanNote key={n.id} note={n} batch={batch} />
          ))}
        </details>
      )}
      {media && (
        <MediaWorkspace
          batch={batch}
          client={media}
          disabled={dirty || frozen}
          selectedSubject={selected}
          onDirtyChange={onMediaDirtyChange}
        />
      )}
      <IdentityDetails>
        <Summary>Retained source identity</Summary>
        <Paragraph>Original source: {batch.source_id}</Paragraph>
        {batch.lots.map((l) => (
          <Paragraph key={l.id}>
            {l.label}: contribution {l.contribution_key}
          </Paragraph>
        ))}
        <Paragraph>No stock has been created by capture.</Paragraph>
      </IdentityDetails>
    </EvidenceArea>
  )
}

const EvidenceArea = styled(Panel)`
  grid-area: context;
`
const ContextCard = styled.div`
  padding: 12px;
  margin-bottom: 12px;
  background: #f7f9fc;
  border: 1px solid #d5dce5;
  border-radius: 5px;
  overflow-wrap: anywhere;
  font-size: 14px;
`
const Facts = styled.dl`
  display: grid;
  grid-template-columns: 75px minmax(0, 1fr);
  gap: 8px;
  margin: 0;
  font-size: 13px;
  dt {
    color: #526179;
  }
  dd {
    margin: 0;
  }
`
const IdentityDetails = styled.details`
  padding: 14px;
  overflow-wrap: anywhere;
  font-size: 12px;
`
