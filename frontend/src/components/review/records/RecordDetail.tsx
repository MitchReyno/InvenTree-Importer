import styled from 'styled-components'
import type { UseQueryResult } from '@tanstack/react-query'
import type {
  BatchRecordDto,
  CaptureSnapshotDto,
  RecordExistingValuesDto,
} from '@invimport/contracts'
import {
  Banner,
  Button,
  Link,
  Small,
  RecordStatePill,
  DataTable,
  DescriptionField,
  DESCRIPTION_LIMIT,
  type DataColumn,
} from '#/components/ui'
import { batchHref } from '#/navigation/batch-route'
import { AskControl } from './AskControl'
import { ProposedCompanyEditor } from './ProposedCompanyEditor'
import { STATE_LABELS, STEP_LABELS, scopeText, specOf } from '#/records/model'
import { color, radius, space, type } from '#/theme/generated/tokens'
import { CompanyEditor } from './CompanyEditor'
import { ParameterEditor } from './ParameterEditor'
import { PartDecision } from './PartDecision'
import { PartEditor } from './PartEditor'
import { SourcingEditor } from './SourcingEditor'
import { TemplateEditor } from './TemplateEditor'
import { FieldSourceChip } from './FieldSourceChip'
import { RecordDescription } from './RecordDescription'
import { LocationDetail } from './LocationDetail'
import type { Save } from './draft'

const FIELD_LABELS: Record<string, string> = {
  name: 'Name',
  description: 'Description',
  category: 'Category',
  tags: 'Tags',
  company: 'Company',
  mpn: 'MPN',
  sku: 'SKU',
  value: 'Value',
  quantity: 'Quantity',
  parameter: 'Parameter',
  manufacturer: 'Manufacturer',
  supplier: 'Supplier',
  units: 'Units',
  path: 'Path',
}

/** Where other records are edited, for types Records shows but does not edit. */
const EDITED_ELSEWHERE: Partial<Record<BatchRecordDto['type'], string>> = {
  category: 'A category is chosen per Part. Open a Part to move it to another category.',
  location: 'Locations are set on lots in Lots, or for the batch in Batch settings.',
  stock_item: 'Stock items are the batch’s lots; their quantities are set in Lots.',
  tag: 'Tags are set per Part. Open a Part to change its tags.',
}

type Props = {
  batch: CaptureSnapshotDto
  record: BatchRecordDto
  save: Save
  disabled: boolean
  reportFor: (source: string) => (dirty: boolean) => void
  /** Some draft on the page is unsaved, so a change that replaces the record waits. */
  dirty?: boolean
  /** Present with agent sessions: sends a message to the step's session working on this record. */
  ask?: (step: string) => ((text: string, key: string) => Promise<void>) | undefined
  /** The target's current values, for a record it already holds. */
  existing?: UseQueryResult<RecordExistingValuesDto>
}

const EXISTING_COLUMNS: DataColumn[] = [
  { id: 'field', header: 'Field' },
  { id: 'existing', header: 'In InvenTree' },
  { id: 'batch', header: 'This batch' },
]

/** A mapped record's current values in InvenTree beside what this batch sets, read on request. */
function ExistingValues({
  record,
  query,
}: {
  record: BatchRecordDto
  query: UseQueryResult<RecordExistingValuesDto>
}) {
  const entry = query.data?.records.find((item) => item.key === record.key)
  if (query.isPending) {
    return <Small role="status">Reading this record in InvenTree…</Small>
  }
  if (query.isError || entry?.status === 'unavailable') {
    return (
      <div role="alert">
        <Banner
          tone="warn"
          action={
            <Button size="sm" disabled={query.isFetching} onClick={() => void query.refetch()}>
              Read InvenTree again
            </Button>
          }
        >
          InvenTree could not be read, so this record’s current values are not shown.
        </Banner>
      </div>
    )
  }
  if (!entry) {
    // Only records past the per-request limit are left unread.
    return query.data?.truncated ? (
      <Small>This batch maps more records than one read covers; this one was not read.</Small>
    ) : null
  }
  if (entry.status !== 'found') {
    return <Banner tone="bad">This record was not found in InvenTree.</Banner>
  }
  return (
    <DataTable
      caption="In InvenTree"
      columns={EXISTING_COLUMNS}
      // The description is shown once, as its own field beside this table, as is a location's path.
      rows={entry.fields
        .filter((field) => field.name !== 'description' && field.name !== 'path')
        .map((field) => {
          const label = FIELD_LABELS[field.name] ?? field.name
          const set = record.fields.find((item) => item.name === field.name)
          return {
            id: field.name,
            label,
            name: label,
            cells: {
              field: { value: label },
              existing: { value: field.value ?? '—' },
              batch: { value: set ? (set.value ?? '—') : 'No change' },
            },
          }
        })}
    />
  )
}

/** One record: its values with who set them, what an edit reaches, and its editor. */
export function RecordDetail({
  batch,
  record,
  save,
  disabled,
  reportFor,
  dirty = false,
  ask,
  existing,
}: Props) {
  // A value not supported yet shows at its field when the record lists that field. A proposed
  // description shows in Not supported yet, as a description field with its count.
  const listed = new Set(
    record.fields.map((field) => field.name).filter((name) => name !== 'description'),
  )
  const atField = (record.unsupported ?? []).filter((item) => listed.has(item.field))
  const elsewhere = (record.unsupported ?? []).filter((item) => !listed.has(item.field))
  const target = record.target
  const spec = target && 'part_subject_id' in target ? specOf(batch, target.part_subject_id) : null
  const report = reportFor(record.key)
  return (
    <Card aria-label={record.label}>
      <Head>
        <Title>{record.label}</Title>
        <RecordStatePill state={record.state}>{STATE_LABELS[record.state]}</RecordStatePill>
      </Head>
      {target && <Small>{scopeText(batch, target)}</Small>}
      {record.lot_ids.length > 0 && record.type !== 'location' && (
        <Small>
          Used by{' '}
          {record.lot_ids.map((lotId, index) => (
            <span key={lotId}>
              {index > 0 && ', '}
              <Link href={batchHref(batch.id, { tab: 'review', view: 'lots', lotId })}>
                {batch.lots.find((lot) => lot.id === lotId)?.label ?? 'a retired lot'}
              </Link>
            </span>
          ))}
          .
        </Small>
      )}
      {record.decision && record.type !== 'part' && !record.proposed && (
        <Small>
          {record.decision.detail}
          {record.type === 'stock_item' && record.lot_ids[0] && (
            <>
              {' '}
              <a
                href={batchHref(batch.id, {
                  tab: 'review',
                  view: 'lots',
                  lotId: record.lot_ids[0],
                })}
              >
                Open this lot
              </a>
            </>
          )}
        </Small>
      )}
      {existing && <ExistingValues record={record} query={existing} />}
      <RecordDescription batch={batch} record={record} existing={existing} />
      {record.type === 'location' && (
        <LocationDetail
          batch={batch}
          record={record}
          existing={existing}
          ask={ask?.('inventory')}
          report={reportFor('ask:location')}
        />
      )}
      {record.fields.length > 0 && (
        <DataTable
          caption={`${record.label}: saved values and who set them`}
          columns={FIELD_COLUMNS}
          rows={record.fields.map((field) => {
            const label = FIELD_LABELS[field.name] ?? field.name
            return {
              id: field.name,
              label,
              name: `${label} as saved`,
              cells: {
                field: { value: label },
                value: { value: field.value ?? '—' },
                source: {
                  value: '',
                  content: (
                    <Source>
                      <FieldSourceChip label={label} field={field} />
                      {field.origin.kind === 'step' &&
                        (() => {
                          const send = ask?.(field.origin.step)
                          const step = STEP_LABELS[field.origin.step]
                          return send ? (
                            <AskControl
                              step={step}
                              value={field.value}
                              prefill={`Please check the ${label.toLowerCase()} of ${record.label}.`}
                              send={send}
                              storeKey={`${batch.id}:ask:${record.key}:${field.name}`}
                              report={reportFor(`ask:${field.name}`)}
                            />
                          ) : null
                        })()}
                      {atField
                        .filter((item) => item.field === field.name)
                        .map((item, index) => (
                          <Small key={index}>
                            Proposed {item.value}: {item.why}
                            {item.reason && ` Proposed because: ${item.reason}`}
                          </Small>
                        ))}
                    </Source>
                  ),
                },
              },
            }
          })}
        />
      )}
      {elsewhere.length > 0 && (
        <Unsupported aria-label="Not supported yet">
          <strong>Not supported yet</strong>
          {elsewhere.map((item, index) => (
            <div key={index}>
              {item.field === 'description' ? (
                <DescriptionField
                  label="Proposed description"
                  value={item.value}
                  limit={DESCRIPTION_LIMIT.default}
                />
              ) : (
                <span>
                  {FIELD_LABELS[item.field] ?? item.field}: {item.value}
                </span>
              )}
              <Small>{item.why}</Small>
              {item.reason && <Small>Proposed because: {item.reason}</Small>}
            </div>
          ))}
        </Unsupported>
      )}
      {record.proposed && (
        <ProposedCompanyEditor
          batch={batch}
          record={record}
          proposed={record.proposed}
          save={save}
          disabled={disabled}
        />
      )}
      {target?.kind === 'company' && (
        <CompanyEditor
          batch={batch}
          role={target.role}
          pk={target.pk}
          save={save}
          disabled={disabled}
          report={report}
        />
      )}
      {target?.kind === 'parameter_template' && (
        <TemplateEditor
          batch={batch}
          pk={target.pk}
          save={save}
          disabled={disabled}
          report={report}
        />
      )}
      {target?.kind === 'part' && spec && (
        <PartEditor
          batch={batch}
          partId={target.part_subject_id}
          spec={spec}
          save={save}
          disabled={disabled}
          reportFor={(source) => reportFor(`${record.key}:${source}`)}
          dirty={dirty}
          record={record}
        />
      )}
      {(target?.kind === 'manufacturer_part' || target?.kind === 'supplier_part') && spec && (
        <SourcingEditor
          batch={batch}
          partId={target.part_subject_id}
          role={target.kind === 'manufacturer_part' ? 'manufacturer' : 'supplier'}
          current={
            target.kind === 'manufacturer_part'
              ? spec.manufacturer && {
                  company: spec.manufacturer.company,
                  code: spec.manufacturer.mpn,
                }
              : spec.supplier && { company: spec.supplier.company, code: spec.supplier.sku }
          }
          save={save}
          disabled={disabled}
          report={report}
        />
      )}
      {target?.kind === 'parameter' &&
        spec?.parameters
          .filter((item) => item.template.pk === target.template_pk)
          .map((parameter) => (
            <ParameterEditor
              key={parameter.template.pk}
              batch={batch}
              partId={target.part_subject_id}
              parameter={parameter}
              save={save}
              disabled={disabled}
              report={report}
            />
          ))}
      {record.decision?.code === 'part_choice_required' && record.part_ids[0] && (
        <PartDecision
          batch={batch}
          partId={record.part_ids[0]}
          save={save}
          disabled={disabled}
          report={report}
        />
      )}
      {!target && EDITED_ELSEWHERE[record.type] && <Small>{EDITED_ELSEWHERE[record.type]}</Small>}
    </Card>
  )
}

const Card = styled.section`
  display: grid;
  gap: ${space[4]};
  min-width: 0;
  padding: ${space[7]} ${space[8]};
  border: 1px solid ${color.line};
  border-radius: ${radius.card};
  background: ${color.surface};
`
const Head = styled.div`
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: ${space[4]};
`
const Title = styled.h2`
  margin: 0;
  ${type.h2}
`
const FIELD_COLUMNS: DataColumn[] = [
  { id: 'field', header: 'Field', nowrap: true },
  { id: 'value', header: 'Value' },
  { id: 'source', header: 'Source' },
]

const Source = styled.div`
  display: grid;
  gap: ${space[2]};
  justify-items: start;
`

const Unsupported = styled.section`
  display: grid;
  gap: ${space[4]};
  padding: ${space[6]};
  border: 1px solid ${color.line};
  border-radius: ${radius.card};
  div {
    display: grid;
    gap: ${space[1]};
  }
`
