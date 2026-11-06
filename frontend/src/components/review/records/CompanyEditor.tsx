import type { CaptureSnapshotDto } from '@invimport/contracts'
import { companiesFor, referenceTo } from '../../../records/model'
import { Label, Select, Small } from '../../ui/primitives'
import { SaveRow, useDraft, useRecordSave, type Save } from './draft'

type Props = {
  batch: CaptureSnapshotDto
  role: 'manufacturer' | 'supplier'
  pk: string
  save: Save
  disabled: boolean
  report: (dirty: boolean) => void
}

/** Points every Part using this company, in this role, at another observed company. */
export function CompanyEditor({ batch, role, pk, save, disabled, report }: Props) {
  const [choice, setChoice] = useDraft('', report)
  const { send, problem, busy } = useRecordSave(batch, save)
  const options = companiesFor(batch, role).filter((item) => item.pk !== pk)
  const chosen = options.find((item) => item.id === choice)

  return (
    <>
      <Label>
        Use another {role}
        <Select
          value={choice}
          disabled={disabled}
          onChange={(event) => setChoice(event.target.value)}
        >
          <option value="">Choose an observed {role}…</option>
          {options.map((item) => (
            <option key={item.id} value={item.id}>
              {item.label}
            </option>
          ))}
        </Select>
      </Label>
      <SaveRow
        disabled={disabled || !chosen}
        busy={busy}
        problem={problem}
        onSave={() =>
          void (
            chosen &&
            send({
              kind: 'record',
              target: { kind: 'company', role, pk },
              operation: { op: 'map_to_existing', reference: referenceTo(chosen) },
            })
          )
        }
      />
      <Small>
        Creating a company is not supported yet. Read another existing company below to choose it.
      </Small>
    </>
  )
}
