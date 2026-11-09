import { useId } from 'react'
import styled from 'styled-components'
import type { UseQueryResult } from '@tanstack/react-query'
import type {
  BatchRecordDto,
  CaptureSnapshotDto,
  RecordExistingValuesDto,
} from '@invimport/contracts'
import { DisabledFeature, Link, Small } from '#/components/ui'
import { Label, Select } from '#/forms'
import { batchHref } from '#/navigation/batch-route'
import {
  existingRead,
  locationPath,
  locationPathText,
  locationUse,
  locationUseText,
  stockQuantityText,
} from '#/records/locations'
import { color, space, typeVar } from '#/theme/generated/tokens'
import { AskControl } from './AskControl'

const TYPE_NOT_READ =
  'Location types aren’t read from InvenTree yet, so this location’s type and its description aren’t shown.'

type Props = {
  batch: CaptureSnapshotDto
  record: BatchRecordDto
  /** Every record in the batch, for each lot's stock item quantity. */
  records: readonly BatchRecordDto[]
  /** The target's current values, read while a mapped location is open. */
  existing?: UseQueryResult<RecordExistingValuesDto>
  /** Sends a message to an Inventory session working on one of the location's lots. */
  ask?: (text: string, key: string) => Promise<void>
  report?: (dirty: boolean) => void
}

/** A stock location's path, why the batch uses it, its type, and the stock going there. */
export function LocationDetail({ batch, record, records, existing, ask, report }: Props) {
  const typeId = useId()
  const use = locationUse(batch, record)
  const path = locationPath(batch, record, existingRead(existing))

  return (
    <>
      <Facts>
        <dt>Path</dt>
        <dd>{locationPathText(path)}</dd>
        <dt>Used as</dt>
        <dd>{locationUseText(use)}</dd>
      </Facts>
      <TypeField>
        <Label htmlFor={typeId}>Location type</Label>
        <DisabledFeature explanation={TYPE_NOT_READ}>
          {(disabled) => (
            <Select id={typeId} value="" onChange={() => undefined} {...disabled}>
              <option value="">Not known</option>
            </Select>
          )}
        </DisabledFeature>
      </TypeField>
      <Section aria-labelledby={`${record.key}-stock`}>
        <Heading id={`${record.key}-stock`}>Stock going here</Heading>
        <Stock aria-labelledby={`${record.key}-stock`}>
          {record.lot_ids.map((lotId) => {
            return (
              <li key={lotId}>
                <Link href={batchHref(batch.id, { tab: 'review', view: 'lots', lotId })}>
                  {batch.lots.find((lot) => lot.id === lotId)?.label ?? 'a retired lot'}
                </Link>
                <Small>
                  {stockQuantityText(records, lotId)}
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

const TypeField = styled.div`
  display: grid;
  gap: ${space[2]};
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
