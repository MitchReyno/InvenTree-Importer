import styled from 'styled-components'
import type { UseQueryResult } from '@tanstack/react-query'
import type {
  BatchRecordDto,
  CaptureSnapshotDto,
  RecordExistingValuesDto,
} from '@invimport/contracts'
import { DESCRIPTION_LIMIT, DescriptionField, Link, Small } from '#/components/ui'
import { batchHref } from '#/navigation/batch-route'
import { locationPath, locationUse, locationUseText, lotQuantity } from '#/records/locations'
import { color, space, typeVar } from '#/theme/generated/tokens'
import { AskControl } from './AskControl'

const TYPE_NOT_READ =
  'Location types aren’t read from InvenTree yet, so this location’s type and its description aren’t shown.'

type Props = {
  batch: CaptureSnapshotDto
  record: BatchRecordDto
  /** The target's current values, read while a mapped location is open. */
  existing?: UseQueryResult<RecordExistingValuesDto>
  /** Sends a message to an Inventory session working on one of the location's lots. */
  ask?: (text: string, key: string) => Promise<void>
  report?: (dirty: boolean) => void
}

/** A stock location's path, why the batch uses it, its type, and the stock going there. */
export function LocationDetail({ batch, record, existing, ask, report }: Props) {
  const use = locationUse(batch, record)
  const reading = record.mapped !== undefined && existing?.isPending && existing.isFetching
  const path = locationPath(batch, record, existing?.data)

  return (
    <>
      <Facts>
        <dt>Path</dt>
        <dd>{path ?? (reading ? 'Reading…' : 'Not known')}</dd>
        <dt>Used as</dt>
        <dd>{locationUseText(use)}</dd>
      </Facts>
      <DescriptionField
        label="Location type"
        value={null}
        limit={DESCRIPTION_LIMIT.default}
        disabledReason={TYPE_NOT_READ}
      />
      <Section aria-labelledby={`${record.key}-stock`}>
        <Heading id={`${record.key}-stock`}>Stock going here</Heading>
        <Stock aria-labelledby={`${record.key}-stock`}>
          {record.lot_ids.map((lotId) => {
            const quantity = lotQuantity(batch, lotId)

            return (
              <li key={lotId}>
                <Link href={batchHref(batch.id, { tab: 'review', view: 'lots', lotId })}>
                  {batch.lots.find((lot) => lot.id === lotId)?.label ?? 'a retired lot'}
                </Link>
                <Small>
                  {quantity === null ? 'Quantity not known' : `${quantity} pcs`}
                  {use.kind === 'override' && ' · overrides the batch default'}
                </Small>
              </li>
            )
          })}
        </Stock>
      </Section>
      {ask && (
        <AskControl
          step="Inventory"
          value={record.label}
          prefill={`Please check the location ${record.label}.`}
          send={ask}
          storeKey={`${batch.id}:ask:${record.key}:location`}
          report={report}
        />
      )}
    </>
  )
}

const Facts = styled.dl`
  display: grid;
  grid-template-columns: max-content minmax(0, 1fr);
  gap: ${space[2]} ${space[6]};
  margin: 0;
  overflow-wrap: anywhere;
  dt {
    color: ${color.muted};
    font-size: ${typeVar.small.size};
  }
  dd {
    margin: 0;
  }
`

const Section = styled.section`
  display: grid;
  gap: ${space[2]};
`

const Heading = styled.h3`
  margin: 0;
  font-size: ${typeVar.small.size};
  font-weight: ${typeVar.bodyStrong.weight};
`

const Stock = styled.ul`
  display: grid;
  gap: ${space[2]};
  margin: 0;
  padding: 0;
  list-style: none;
  li {
    display: flex;
    flex-wrap: wrap;
    align-items: baseline;
    gap: ${space[3]};
  }
`
