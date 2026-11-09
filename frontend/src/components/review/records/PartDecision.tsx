import type { CaptureSnapshotDto } from '@invimport/contracts'
import { batchHref } from '#/navigation/batch-route'
import { observed, referenceTo } from '#/records/model'
import { Input, Label, Link, Select, Small } from '#/components/ui'
import { SaveRow, useDraft, useRecordSave, type Save } from './draft'

type Props = {
  batch: CaptureSnapshotDto
  partId: string
  save: Save
  disabled: boolean
  report: (dirty: boolean) => void
}

/** A Part with no spec: choose an existing Part, or start a new one from a name and category. */
export function PartDecision({ batch, partId, save, disabled, report }: Props) {
  const [draft, setDraft, , reset] = useDraft({ name: '', category: '' }, report)
  const { send, problem, busy, retry } = useRecordSave(batch, save, reset)
  const categories = observed(batch, 'category')
  const category = categories.find((item) => item.id === draft.category)
  return (
    <>
      <Small>
        Choose an existing Part in the{' '}
        <Link href={batchHref(batch.id, { tab: 'review', view: 'lots' }, `?edit=${partId}`)}>
          shared Part editor
        </Link>
        , or start a new one here.
      </Small>
      <Label>
        New Part name
        <Input
          value={draft.name}
          maxLength={256}
          disabled={disabled || busy}
          onChange={(event) => setDraft({ ...draft, name: event.target.value })}
        />
      </Label>
      <Label>
        Existing category
        <Select
          value={draft.category}
          disabled={disabled || busy}
          onChange={(event) => setDraft({ ...draft, category: event.target.value })}
        >
          <option value="">Choose an observed category…</option>
          {categories.map((item) => (
            <option key={item.id} value={item.id}>
              {item.label}
            </option>
          ))}
        </Select>
      </Label>
      <SaveRow
        label="Start a new Part"
        disabled={disabled || !category || !draft.name.trim()}
        busy={busy}
        problem={problem}
        retry={retry}
        onSave={() =>
          void (
            category &&
            send({
              kind: 'part',
              id: partId,
              choice: {
                mode: 'create',
                spec: {
                  name: draft.name.trim(),
                  category: referenceTo(category),
                  parameters: [],
                  manufacturer: null,
                  supplier: null,
                  tags: [],
                },
              },
            })
          )
        }
      />
    </>
  )
}
