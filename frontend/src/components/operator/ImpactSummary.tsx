import styled from 'styled-components'
import { media } from '../ui/media'
import { color, space, typeVar } from '../../theme/generated/tokens'
import type { CaptureSnapshotDto, OperatorImpactDto } from '@invimport/contracts'
import { Paragraph, Small } from '../ui/primitives'

interface Props {
  batch: CaptureSnapshotDto
  impact: OperatorImpactDto
  /** Exact lots named by the command, shown before anything else. */
  selectedLotIds: string[]
  /** Active lots left out of the command. */
  excludedLotIds?: string[]
}

function lotLabel(batch: CaptureSnapshotDto, id: string) {
  return batch.lots.find((lot) => lot.id === id)?.label ?? `Lot ${id.slice(0, 8)}`
}

function partLabel(batch: CaptureSnapshotDto, id: string) {
  return batch.parts.find((part) => part.id === id)?.label ?? `Part proposal ${id.slice(0, 8)}`
}

function subjectLabel(batch: CaptureSnapshotDto, id: string) {
  if (batch.parts.some((part) => part.id === id)) {
    return `${partLabel(batch, id)} (shared Part)`
  }
  return lotLabel(batch, id)
}

function Names({ title, names }: { title: string; names: string[] }) {
  return (
    <Row>
      <dt>{title}</dt>
      <dd>{names.length ? names.join(', ') : 'None'}</dd>
    </Row>
  )
}

/** Server dry-run result: nothing below has been saved yet. */
export function ImpactSummary({ batch, impact, selectedLotIds, excludedLotIds = [] }: Props) {
  return (
    <section aria-label="Impact preview">
      <Paragraph>
        <strong>Preview only.</strong> The server ran this change and rolled it back.
      </Paragraph>
      <List>
        <Names
          title="Lots in this change"
          names={selectedLotIds.map((id) => lotLabel(batch, id))}
        />
        <Names title="Not included" names={excludedLotIds.map((id) => lotLabel(batch, id))} />
        <Names
          title="Shared Parts affected"
          names={impact.affected_part_ids.map((id) => partLabel(batch, id))}
        />
        <Names
          title="Reviews invalidated"
          names={impact.invalidated_review_subject_ids.map((id) => subjectLabel(batch, id))}
        />
        <Names
          title="Lots whose review facts change"
          names={impact.affected_lot_ids.map((id) => lotLabel(batch, id))}
        />
        <Names
          title="Lots retired"
          names={impact.retired_lot_ids.map((id) => lotLabel(batch, id))}
        />
        <Names title="Lots created" names={impact.created_lots.map((lot) => lot.label)} />
        {impact.created_part && (
          <Names title="Part proposal created" names={[impact.created_part.label]} />
        )}
        <Row>
          <dt>Unapproved preparations made stale</dt>
          <dd>{impact.stale_preparation_ids.length}</dd>
        </Row>
      </List>
      <Small>
        Applying sends the same change with the batch revision shown when you previewed.
      </Small>
    </section>
  )
}

const List = styled.dl`
  display: grid;
  gap: ${space[3]};
  margin: 0 0 ${space[6]};
`
const Row = styled.div`
  display: grid;
  grid-template-columns: minmax(140px, 220px) 1fr;
  gap: ${space[6]};
  dt {
    color: ${color.muted};
    font-size: ${typeVar.small.size};
  }
  dd {
    margin: 0;
    overflow-wrap: anywhere;
  }
  ${media.narrow} {
    grid-template-columns: 1fr;
    gap: ${space[1]};
  }
`
