import { recordScope, type CaptureSnapshotDto } from '@invimport/contracts'
import {
  mappingsFor,
  observed,
  partName,
  partTemplates,
  referenceTo,
  specOf,
} from '#/records/model'
import { Small } from '#/components/ui'
import { CheckboxLabel, ChoicePicker, Fieldset } from '#/forms'
import { SaveRow, useDraft, useRecordSave, type Save } from './draft'

type Props = {
  batch: CaptureSnapshotDto
  pk: string
  save: Save
  disabled: boolean
  report: (dirty: boolean) => void
}

type Draft = { template: string; mappings: Record<string, string>; exclude: string[] }

/** Maps a template to another across every Part using it, with a mapping per category. */
export function TemplateEditor({ batch, pk, save, disabled, report }: Props) {
  const [draft, setDraft, , reset] = useDraft<Draft>(
    { template: '', mappings: {}, exclude: [] },
    report,
  )
  const { send, problem, busy, retry } = useRecordSave(batch, save, reset)
  const target = { kind: 'parameter_template' as const, pk }
  const partIds = recordScope(batch, target).partIds
  const categories = [
    ...new Map(
      partIds.flatMap((id) => {
        const spec = specOf(batch, id)
        if (!spec) {
          return []
        }
        const label =
          batch.observations.find((item) => item.id === spec.category.observation_id)?.label ??
          spec.category.pk
        return [[spec.category.pk, label] as const]
      }),
    ),
  ]
  const templates = partTemplates(batch).filter((item) => item.pk !== pk)
  const template = templates.find((item) => item.id === draft.template)
  const mappingObservations = observed(batch, 'category_parameter')

  function submit() {
    if (!template) {
      return
    }
    const chosen = Object.values(draft.mappings)
      .map((idValue) => mappingObservations.find((item) => item.id === idValue))
      .filter((item) => item !== undefined)
    void send({
      kind: 'record',
      target,
      operation: {
        op: 'map_template',
        template: referenceTo(template),
        category_mappings: chosen.map(referenceTo),
        exclude_parts: draft.exclude,
      },
    })
  }

  return (
    <>
      <ChoicePicker
        label="Use another template"
        noun="templates"
        placeholder="Choose an observed template…"
        choices={templates.map((item) => ({ value: item.id, label: item.label }))}
        value={draft.template}
        disabled={disabled || busy}
        onChange={(value) => setDraft({ ...draft, template: value, mappings: {} })}
      />
      {template &&
        categories.map(([category, label]) => (
          <ChoicePicker
            key={category}
            label={`Mapping in ${label}`}
            noun="mappings"
            placeholder="Choose a mapping…"
            choices={[
              { value: '', label: `No mapping in ${label}` },
              ...mappingsFor(batch, category, template.pk).map((item) => ({
                value: item.id,
                label: item.label,
              })),
            ]}
            value={draft.mappings[category] ?? ''}
            disabled={disabled || busy}
            onChange={(value) =>
              setDraft({ ...draft, mappings: { ...draft.mappings, [category]: value } })
            }
          />
        ))}
      <Fieldset>
        <legend>Leave out</legend>
        {partIds.map((id) => (
          <CheckboxLabel key={id}>
            <input
              type="checkbox"
              aria-label={`Exclude ${partName(batch, id)}`}
              checked={draft.exclude.includes(id)}
              disabled={disabled || busy}
              onChange={(event) =>
                setDraft({
                  ...draft,
                  exclude: event.target.checked
                    ? [...draft.exclude, id]
                    : draft.exclude.filter((item) => item !== id),
                })
              }
            />
            {partName(batch, id)}
          </CheckboxLabel>
        ))}
      </Fieldset>
      <SaveRow
        disabled={disabled || !template}
        busy={busy}
        problem={problem}
        retry={retry}
        onSave={submit}
      />
      <Small>
        Each category needs a mapping for the new template; a category with none is refused unless
        its Parts are left out. Creating a template is not supported yet.
      </Small>
    </>
  )
}
