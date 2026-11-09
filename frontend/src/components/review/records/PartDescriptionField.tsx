import type { CaptureSnapshotDto, RecordFieldDto } from '@invimport/contracts'
import { DESCRIPTION_LIMIT, DescriptionField } from '#/components/ui'
import { SaveRow, useDraft, useRecordSave, type Save } from './draft'
import { FieldSourceChip } from './FieldSourceChip'

type Props = {
  batch: CaptureSnapshotDto
  partId: string
  saved: string
  /** The saved description's field, for its source chip. */
  field?: RecordFieldDto
  save: Save
  disabled: boolean
  report: (dirty: boolean) => void
}

/** InvenTree keeps a Part description on one line. */
function oneLine(value: string) {
  return value.replace(/\s+/g, ' ').trim()
}

/** A new Part's description with its count; a save over InvenTree's limit waits for a shorter one. */
export function PartDescriptionField({
  batch,
  partId,
  saved,
  field,
  save,
  disabled,
  report,
}: Props) {
  const [value, setValue, dirty] = useDraft(saved, report)
  const { send, problem, busy, retry } = useRecordSave(batch, save)
  const normalized = oneLine(value)
  const over = Array.from(normalized).length > DESCRIPTION_LIMIT.default

  async function submit() {
    const accepted = await send({
      kind: 'record',
      target: { kind: 'part', part_subject_id: partId },
      operation: { op: 'set_description', value: normalized || null },
    })
    // Keep what the server stored, so the accepted value reads as saved.
    if (accepted) {
      setValue(normalized)
    }
  }

  return (
    <>
      <DescriptionField
        label="Description"
        value={value}
        limit={DESCRIPTION_LIMIT.default}
        source={field && <FieldSourceChip label="Description" field={field} />}
        disabled={disabled || busy}
        onChange={setValue}
      />
      <SaveRow
        label="Save description"
        disabled={disabled || !dirty || over}
        busy={busy}
        problem={problem}
        retry={retry}
        onSave={submit}
      />
    </>
  )
}
