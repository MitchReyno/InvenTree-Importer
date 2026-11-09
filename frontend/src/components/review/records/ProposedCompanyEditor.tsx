import { useState } from 'react'
import type { BatchRecordDto, CaptureSnapshotDto } from '@invimport/contracts'
import { companiesFor, partName, referenceTo, specOf } from '#/records/model'
import { Label, Select, Small } from '#/components/ui'
import { CompanyDecision } from './CompanyDecision'
import { SaveRow, useRecordSave, type Save } from './draft'

type Proposed = NonNullable<BatchRecordDto['proposed']>

/**
 * A proposed new company the executor cannot create: the operator uses the likely existing match
 * or picks another observed company, which sets that role, with the proposed number, on its Part.
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
  // One record per Part: the projection asks only about a Part being created.
  const partId = record.part_ids.find((id) => specOf(batch, id) !== null)
  const companies = companiesFor(batch, proposed.role)
  const number = proposed.number
  const noun = proposed.role === 'manufacturer' ? 'part number' : 'SKU'
  const scope = partId
    ? `Sets the ${proposed.role} of ${partName(batch, partId)} to the chosen company${number ? `, with ${noun} ${number}` : ''}.`
    : 'The Part it was proposed for is no longer being created.'

  function use(reference: NonNullable<Proposed['likely']>['reference']) {
    if (!partId || !number) {
      return
    }
    void send(
      proposed.role === 'manufacturer'
        ? {
            kind: 'record',
            target: { kind: 'manufacturer_part', part_subject_id: partId },
            operation: { op: 'set_mpn', company: reference, mpn: number },
          }
        : {
            kind: 'record',
            target: { kind: 'supplier_part', part_subject_id: partId },
            operation: { op: 'set_sku', company: reference, sku: number },
          },
    )
  }

  const blocked = disabled || busy || !number || !partId
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
        onUseLikely={() => use(proposed.likely!.reference)}
      />
      {!number && (
        <Small>
          No {noun} was proposed, so set the {proposed.role} on the Part instead.
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
        onSave={() => chosen && use(referenceTo(chosen))}
      />
    </>
  )
}
