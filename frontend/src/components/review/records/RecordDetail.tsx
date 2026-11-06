import styled from 'styled-components'
import type { BatchRecordDto, CaptureSnapshotDto } from '@invimport/contracts'
import { batchHref } from '../../../navigation/batch-route'
import { STATE_LABELS, STEP_LABELS, scopeText, specOf } from '../../../records/model'
import { color, radius, space, type } from '../../../theme/generated/tokens'
import { Pill, type PillTone } from '../../ui/Pill'
import { Small } from '../../ui/primitives'
import { CompanyEditor } from './CompanyEditor'
import { ParameterEditor } from './ParameterEditor'
import { PartDecision } from './PartDecision'
import { PartEditor } from './PartEditor'
import { SourcingEditor } from './SourcingEditor'
import { TemplateEditor } from './TemplateEditor'
import type { Save } from './draft'

export const STATE_TONE: Record<BatchRecordDto['state'], PillTone> = {
  new: 'info',
  exists: 'neutral',
  update: 'acc',
  choose: 'warn',
  unsupported: 'bad',
}

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
}

/** One record: its values with who set them, what an edit reaches, and its editor. */
export function RecordDetail({ batch, record, save, disabled, reportFor }: Props) {
  const target = record.target
  const spec = target && 'part_subject_id' in target ? specOf(batch, target.part_subject_id) : null
  const report = reportFor(record.key)
  return (
    <Card aria-label={record.label}>
      <Head>
        <Title>{record.label}</Title>
        <Pill tone={STATE_TONE[record.state]}>{STATE_LABELS[record.state]}</Pill>
      </Head>
      {target ? (
        <Small>{scopeText(batch, target)}</Small>
      ) : (
        record.lot_ids.length > 0 && (
          <Small>
            Used by {record.lot_ids.length} {record.lot_ids.length === 1 ? 'lot' : 'lots'}.
          </Small>
        )
      )}
      {record.decision && record.type !== 'part' && (
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
      {record.fields.length > 0 && (
        <Fields>
          <tbody>
            {record.fields.map((field) => (
              <tr
                key={field.name}
                aria-label={`${FIELD_LABELS[field.name] ?? field.name} as saved`}
              >
                <th scope="row">{FIELD_LABELS[field.name] ?? field.name}</th>
                <td>{field.value ?? '—'}</td>
                <td>
                  <Small>
                    {field.origin.kind === 'step'
                      ? `Proposed by ${STEP_LABELS[field.origin.step]}`
                      : 'Set by you'}
                  </Small>
                </td>
              </tr>
            ))}
          </tbody>
        </Fields>
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
  gap: ${space[2]};
  min-width: 0;
  padding: ${space['3-5']} ${space[4]};
  border: 1px solid ${color.line};
  border-radius: ${radius.card};
  background: ${color.surface};
`
const Head = styled.div`
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: ${space[2]};
`
const Title = styled.h2`
  margin: 0;
  ${type.h2}
`
const Fields = styled.table`
  border-collapse: collapse;
  th,
  td {
    padding: ${space[1]} ${space[2]} ${space[1]} 0;
    text-align: left;
    vertical-align: top;
  }
`
