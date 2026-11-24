import type { CaptureSnapshotDto, InventoryPartSpecDto } from '@invimport/contracts'
import { mappingsFor, partTemplates, referenceTo } from '#/records/model'
import { Button } from '#/components/ui'
import { ChoicePicker, Input, Label } from '#/forms'
import { SaveRow, useDraft, useRecordSave, type Save } from './draft'
import { useRecordSaving } from '#/context'

type Parameter = InventoryPartSpecDto['parameters'][number]

type Props = {
  batch: CaptureSnapshotDto
  partId: string
  parameter: Parameter
  save: Save
  disabled: boolean
  report: (dirty: boolean) => void
}

const templateLabel = (batch: CaptureSnapshotDto, parameter: Parameter) =>
  batch.observations.find((item) => item.id === parameter.template.observation_id)?.label ??
  parameter.template.pk

/** One parameter on one Part: change its value or remove it. */
export function ParameterEditor({ batch, partId, parameter, save, disabled, report }: Props) {
  const [value, setValue, dirty] = useDraft(parameter.value, report)
  const { send, problem, busy, retry } = useRecordSave(batch, save)
  const { saving } = useRecordSaving()
  const name = templateLabel(batch, parameter)
  const target = {
    kind: 'parameter' as const,
    part_subject_id: partId,
    template_pk: parameter.template.pk,
  }
  return (
    <>
      <Label>
        {name}
        <Input
          value={value}
          maxLength={256}
          disabled={disabled || busy}
          onChange={(event) => setValue(event.target.value)}
        />
      </Label>
      <SaveRow
        label={`Save ${name}`}
        disabled={disabled || !dirty || !value.trim()}
        busy={busy}
        problem={problem}
        retry={retry}
        onSave={async () => {
          const trimmed = value.trim()
          const saved = await send({
            kind: 'record',
            target,
            operation: {
              op: 'set_parameter',
              template: parameter.template,
              category_mapping: parameter.category_mapping,
              value: trimmed,
            },
          })
          // Keep what the server stored, so the accepted value reads as saved.
          if (saved) {
            setValue(trimmed)
          }
        }}
      >
        <Button
          size="sm"
          variant="ghost"
          disabled={disabled || busy || saving}
          onClick={() =>
            void send({ kind: 'record', target, operation: { op: 'remove_parameter' } })
          }
        >
          Remove {name}
        </Button>
      </SaveRow>
    </>
  )
}

type NewDraft = { template: string; mapping: string; value: string }

/** Adds a parameter from an observed template mapped in the Part's category. */
export function NewParameter({
  batch,
  partId,
  spec,
  save,
  disabled,
  report,
}: Omit<Props, 'parameter'> & { spec: InventoryPartSpecDto }) {
  const [draft, setDraft, , reset] = useDraft<NewDraft>(
    { template: '', mapping: '', value: '' },
    report,
  )
  const { send, problem, busy, retry } = useRecordSave(batch, save, reset)
  const used = new Set(spec.parameters.map((item) => item.template.pk))
  const templates = partTemplates(batch).filter((item) => !used.has(item.pk))
  const template = templates.find((item) => item.id === draft.template)
  const mappings = template ? mappingsFor(batch, spec.category.pk, template.pk) : []
  const mapping = mappings.find((item) => item.id === draft.mapping)
  return (
    <>
      <ChoicePicker
        label="Add a parameter"
        clearable
        noun="templates"
        placeholder="Choose an observed template…"
        choices={templates.map((item) => ({ value: item.id, label: item.label }))}
        value={draft.template}
        disabled={disabled || busy}
        onChange={(value) => setDraft({ ...draft, template: value, mapping: '' })}
      />
      {template && (
        <>
          <ChoicePicker
            label="Mapping in this category"
            clearable
            noun="mappings"
            placeholder="Choose a mapping…"
            choices={mappings.map((item) => ({ value: item.id, label: item.label }))}
            value={draft.mapping}
            disabled={disabled || busy}
            onChange={(value) => setDraft({ ...draft, mapping: value })}
          />
          <Label>
            Value
            <Input
              value={draft.value}
              maxLength={256}
              disabled={disabled || busy}
              onChange={(event) => setDraft({ ...draft, value: event.target.value })}
            />
          </Label>
        </>
      )}
      <SaveRow
        label="Add parameter"
        disabled={disabled || !template || !mapping || !draft.value.trim()}
        busy={busy}
        problem={problem}
        retry={retry}
        onSave={() =>
          void (
            template &&
            mapping &&
            send({
              kind: 'record',
              target: { kind: 'parameter', part_subject_id: partId, template_pk: template.pk },
              operation: {
                op: 'set_parameter',
                template: referenceTo(template),
                category_mapping: referenceTo(mapping),
                value: draft.value.trim(),
              },
            })
          )
        }
      />
    </>
  )
}
