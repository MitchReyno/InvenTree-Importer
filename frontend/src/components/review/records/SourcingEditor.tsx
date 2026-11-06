import type { CaptureSnapshotDto } from '@invimport/contracts'
import { companiesFor, referenceTo } from '../../../records/model'
import { Input, Label, Select } from '../../ui/primitives'
import { SaveRow, useDraft, useRecordSave, type Save } from './draft'

type Reference = {
  observation_id: string
  target_context_id: string
  model: 'company'
  pk: string
}

type Props = {
  batch: CaptureSnapshotDto
  partId: string
  role: 'manufacturer' | 'supplier'
  current: { company: Reference; code: string } | null
  save: Save
  disabled: boolean
  report: (dirty: boolean) => void
}

/** A Part's manufacturer part (company and MPN) or supplier part (company and SKU). */
export function SourcingEditor({ batch, partId, role, current, save, disabled, report }: Props) {
  const [draft, setDraft, dirty] = useDraft(
    { company: current?.company.observation_id ?? '', code: current?.code ?? '' },
    report,
  )
  const { send, problem, busy, retry } = useRecordSave(batch, save)
  const companies = companiesFor(batch, role)
  const company = companies.find((item) => item.id === draft.company)
  const code = role === 'manufacturer' ? 'MPN' : 'SKU'
  return (
    <>
      <Label>
        {role === 'manufacturer' ? 'Manufacturer' : 'Supplier'}
        <Select
          value={draft.company}
          disabled={disabled}
          onChange={(event) => setDraft({ ...draft, company: event.target.value })}
        >
          <option value="">Choose an observed {role}…</option>
          {companies.map((item) => (
            <option key={item.id} value={item.id}>
              {item.label}
            </option>
          ))}
        </Select>
      </Label>
      <Label>
        {code}
        <Input
          value={draft.code}
          maxLength={256}
          disabled={disabled}
          onChange={(event) => setDraft({ ...draft, code: event.target.value })}
        />
      </Label>
      <SaveRow
        label={current ? 'Save' : `Add ${role} part`}
        disabled={disabled || !dirty || !company || !draft.code.trim()}
        busy={busy}
        problem={problem}
        retry={retry}
        onSave={() =>
          void (
            company &&
            send(
              role === 'manufacturer'
                ? {
                    kind: 'record',
                    target: { kind: 'manufacturer_part', part_subject_id: partId },
                    operation: {
                      op: 'set_mpn',
                      company: referenceTo(company),
                      mpn: draft.code.trim(),
                    },
                  }
                : {
                    kind: 'record',
                    target: { kind: 'supplier_part', part_subject_id: partId },
                    operation: {
                      op: 'set_sku',
                      company: referenceTo(company),
                      sku: draft.code.trim(),
                    },
                  },
            )
          )
        }
      />
    </>
  )
}
