import { useState } from 'react'
import type { BatchRecordDto, CaptureSnapshotDto } from '@invimport/contracts'
import { companiesFor, partName, referenceTo, specOf } from '../../../records/model'
import { Label, Select, Small } from '../../ui/primitives'
import { CompanyDecision } from './CompanyDecision'
import { SaveRow, useRecordSave, type Save } from './draft'

type Proposed = NonNullable<BatchRecordDto['proposed']>

/**
 * A proposed new company the executor cannot create: the operator uses the likely existing match
 * or picks another observed company, which sets that role, with the proposed number, on each Part.
 */
export function ProposedCompanyEditor({
  batch,
  record,
  proposed,
  save,
  disabled,
}: {
  batch: CaptureSnapshotDto
  record: BatchRecordDto
  proposed: Proposed
  save: Save
  disabled: boolean
}) {
  const { send, problem, busy, retry } = useRecordSave(batch, save)
  const [other, setOther] = useState('')
  const parts = record.part_ids.filter((id) => specOf(batch, id) !== null)
  const companies = companiesFor(batch, proposed.role)
  const number = proposed.number
  const noun = proposed.role === 'manufacturer' ? 'part number' : 'SKU'
  const scope = parts.length
    ? `Sets the ${proposed.role} of ${parts.map((id) => partName(batch, id)).join(', ')} to the chosen company${number ? `, with ${noun} ${number}` : ''}.`
    : 'No Part using it has a new Part to set it on yet.'

  async function use(reference: NonNullable<Proposed['likely']>['reference']) {
    for (const partId of parts) {
      const ok = await send(
        proposed.role === 'manufacturer'
          ? {
              kind: 'record',
              target: { kind: 'manufacturer_part', part_subject_id: partId },
              operation: { op: 'set_mpn', company: reference, mpn: number! },
            }
          : {
              kind: 'record',
              target: { kind: 'supplier_part', part_subject_id: partId },
              operation: { op: 'set_sku', company: reference, sku: number! },
            },
      )
      if (!ok) {
        return
      }
    }
  }

  const blocked = disabled || busy || !number || parts.length === 0
  const chosen = companies.find((item) => item.id === other)
  return (
    <>
      <CompanyDecision
        role={proposed.role}
        proposed={{ name: proposed.name, reason: proposed.reason ?? 'No reason was given.' }}
        likely={
          proposed.likely ? { label: proposed.likely.label, reason: proposed.likely.why } : null
        }
        scope={scope}
        disabled={blocked}
        onUseLikely={() => void use(proposed.likely!.reference)}
      />
      {!number && (
        <Small>
          No {noun} was proposed, so set the {proposed.role} on each Part instead.
        </Small>
      )}
      <Label>
        Use another {proposed.role}
        <Select value={other} disabled={blocked} onChange={(event) => setOther(event.target.value)}>
          <option value="">Choose an observed {proposed.role}</option>
          {companies.map((item) => (
            <option key={item.id} value={item.id}>
              {item.label}
            </option>
          ))}
        </Select>
      </Label>
      <SaveRow
        label={`Use this ${proposed.role}`}
        disabled={blocked || !chosen}
        busy={busy}
        problem={problem}
        retry={retry}
        onSave={() => chosen && void use(referenceTo(chosen))}
      />
    </>
  )
}
