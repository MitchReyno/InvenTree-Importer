import { useCallback, useRef, useState } from 'react'
import type { BatchRecordDto, CaptureSnapshotDto, InventoryPartSpecDto } from '@invimport/contracts'
import { Banner } from '../../ui/Banner'
import { Button } from '../../ui/Button'
import { batchHref } from '../../../navigation/batch-route'
import { mappingsFor, observed, referenceTo } from '../../../records/model'
import { CheckboxLabel, Fieldset, Input, Label, Link, Select, Small } from '../../ui/primitives'
import { SaveRow, useDraft, useRecordSave, type Save } from './draft'
import { ParameterEditor, NewParameter } from './ParameterEditor'
import { SourcingEditor } from './SourcingEditor'

type Props = {
  batch: CaptureSnapshotDto
  partId: string
  spec: InventoryPartSpecDto
  save: Save
  disabled: boolean
  reportFor: (source: string) => (dirty: boolean) => void
  /** The Part's record: the existing Part its step did not reuse, and its category reasoning. */
  record?: Pick<BatchRecordDto, 'reuse' | 'category_reason'>
}

/** One Part's own fields; each section saves on its own and says what it applies to. */
export function PartEditor({ batch, partId, spec, save, disabled, reportFor: report, record }: Props) {
  const target = { kind: 'part' as const, part_subject_id: partId }
  const reuse = record?.reuse
  const reasoning = record?.category_reason
  const { dirty, reportFor } = useOwnDrafts(report)
  const reusing = useRecordSave(batch, save)
  return (
    <>
      {reuse && (
        <Banner tone="info" icon="≈">
          Not reusing {reuse.label}: {reuse.reason}{' '}
          <Button
            size="sm"
            variant="link"
            disabled={disabled || dirty || reusing.busy}
            onClick={() =>
              void reusing.send({
                kind: 'part',
                id: partId,
                choice: { mode: 'set', value: reuse.reference },
              })
            }
          >
            Use {reuse.label} instead
          </Button>
          {/* Reusing replaces this Part's fields, so their unsaved drafts would be lost. */}
          {dirty && <Small> Save or discard this Part’s changes first.</Small>}
          {reusing.problem && <Small role="alert"> {reusing.problem}</Small>}
          {reusing.retry && (
            <Button size="sm" variant="ghost" onClick={() => void reusing.retry?.()}>
              Load current values
            </Button>
          )}
        </Banner>
      )}
      <TextField
        batch={batch}
        label="Name"
        saved={spec.name}
        maxLength={256}
        disabled={disabled}
        report={reportFor('name')}
        normalize={(value) => value.trim()}
        onSave={(value, send) =>
          send({ kind: 'record', target, operation: { op: 'set_name', value } })
        }
        save={save}
        required
      />
      <TextField
        batch={batch}
        label="Description"
        saved={spec.description ?? ''}
        maxLength={250}
        disabled={disabled}
        report={reportFor('description')}
        normalize={(value) => value.replace(/\s+/g, ' ').trim()}
        onSave={(value, send) =>
          send({
            kind: 'record',
            target,
            operation: { op: 'set_description', value: value || null },
          })
        }
        save={save}
      />
      <TextField
        batch={batch}
        label="Tags"
        hint="Separate tags with commas."
        saved={spec.tags.join(', ')}
        maxLength={3300}
        disabled={disabled}
        report={reportFor('tags')}
        normalize={(value) => tagList(value).join(', ')}
        onSave={(value, send) =>
          send({ kind: 'record', target, operation: { op: 'set_tags', tags: tagList(value) } })
        }
        save={save}
      />
      <CategoryField
        batch={batch}
        partId={partId}
        spec={spec}
        save={save}
        disabled={disabled}
        report={reportFor('category')}
      />
      {reasoning && (
        <Small>
          {[
            reasoning.reason && `Chosen because ${reasoning.reason.replace(/\.$/, '')}.`,
            reasoning.alternative &&
              `Alternative considered: ${reasoning.alternative.name}${reasoning.alternative.reason ? ` (${reasoning.alternative.reason.replace(/\.$/, '')})` : ''}.`,
          ]
            .filter(Boolean)
            .join(' ')}
        </Small>
      )}
      <Fieldset>
        <legend>Parameters</legend>
        {spec.parameters.length === 0 && <Small>No parameters.</Small>}
        {spec.parameters.map((parameter) => (
          <ParameterEditor
            key={parameter.template.pk}
            batch={batch}
            partId={partId}
            parameter={parameter}
            save={save}
            disabled={disabled}
            report={reportFor(`parameter:${parameter.template.pk}`)}
          />
        ))}
        <NewParameter
          batch={batch}
          partId={partId}
          spec={spec}
          save={save}
          disabled={disabled}
          report={reportFor('parameter:new')}
        />
      </Fieldset>
      <Fieldset>
        <legend>Sourcing</legend>
        <SourcingEditor
          batch={batch}
          partId={partId}
          role="manufacturer"
          current={
            spec.manufacturer && { company: spec.manufacturer.company, code: spec.manufacturer.mpn }
          }
          save={save}
          disabled={disabled}
          report={reportFor('manufacturer')}
        />
        <SourcingEditor
          batch={batch}
          partId={partId}
          role="supplier"
          current={spec.supplier && { company: spec.supplier.company, code: spec.supplier.sku }}
          save={save}
          disabled={disabled}
          report={reportFor('supplier')}
        />
      </Fieldset>
      <Small>
        Part images come from evidence chosen in{' '}
        <Link href={batchHref(batch.id, { tab: 'capture' })}>Capture</Link>. Changing an existing
        InvenTree Part is not supported yet.
      </Small>
    </>
  )
}

const tagList = (value: string) => [
  ...new Set(
    value
      .split(',')
      .map((tag) => tag.trim())
      .filter(Boolean),
  ),
]

function TextField({
  batch,
  label,
  hint,
  saved,
  maxLength,
  required = false,
  disabled,
  report,
  normalize = (value) => value,
  onSave,
  save,
}: {
  batch: CaptureSnapshotDto
  label: string
  hint?: string
  saved: string
  maxLength: number
  required?: boolean
  disabled: boolean
  report: (dirty: boolean) => void
  /** The form the server stores; it is sent, and kept as the draft once accepted. */
  normalize?: (value: string) => string
  onSave: (value: string, send: ReturnType<typeof useRecordSave>['send']) => Promise<boolean>
  save: Save
}) {
  const [value, setValue, dirty] = useDraft(saved, report)
  const { send, problem, busy, retry } = useRecordSave(batch, save)
  return (
    <>
      <Label>
        {label}
        <Input
          value={value}
          maxLength={maxLength}
          disabled={disabled || busy}
          onChange={(event) => setValue(event.target.value)}
        />
      </Label>
      {hint && <Small>{hint}</Small>}
      <SaveRow
        label={`Save ${label.toLowerCase()}`}
        disabled={disabled || !dirty || (required && !value.trim())}
        busy={busy}
        problem={problem}
        retry={retry}
        onSave={async () => {
          const normalized = normalize(value)
          if (await onSave(normalized, send)) {
            setValue(normalized)
          }
        }}
      />
    </>
  )
}

type CategoryDraft = { category: string; mappings: Record<string, string>; drop: string[] }

/** A category change maps or drops each parameter in the new category; nothing is guessed. */
function CategoryField({
  batch,
  partId,
  spec,
  save,
  disabled,
  report,
}: {
  batch: CaptureSnapshotDto
  partId: string
  spec: InventoryPartSpecDto
  save: Save
  disabled: boolean
  report: (dirty: boolean) => void
}) {
  const [draft, setDraft, , reset] = useDraft<CategoryDraft>(
    { category: '', mappings: {}, drop: [] },
    report,
  )
  const { send, problem, busy, retry } = useRecordSave(batch, save, reset)
  const categories = observed(batch, 'category').filter((item) => item.pk !== spec.category.pk)
  const category = categories.find((item) => item.id === draft.category)

  const templateLabel = (observationId: string, pk: string) =>
    batch.observations.find((item) => item.id === observationId)?.label ?? pk

  const mappingObservations = observed(batch, 'category_parameter')

  function submit() {
    if (!category) {
      return
    }
    void send({
      kind: 'record',
      target: { kind: 'part', part_subject_id: partId },
      operation: {
        op: 'set_category',
        reference: referenceTo(category),
        parameter_mappings: Object.entries(draft.mappings).flatMap(([templatePk, mappingId]) => {
          const mapping = mappingObservations.find((item) => item.id === mappingId)
          return mapping && !draft.drop.includes(templatePk)
            ? [{ template_pk: templatePk, category_mapping: referenceTo(mapping) }]
            : []
        }),
        drop_parameters: draft.drop,
      },
    })
  }

  return (
    <Fieldset>
      <legend>Category</legend>
      <Label>
        Move to category
        <Select
          value={draft.category}
          disabled={disabled || busy}
          onChange={(event) => setDraft({ category: event.target.value, mappings: {}, drop: [] })}
        >
          <option value="">
            Keep {templateLabel(spec.category.observation_id, spec.category.pk)}
          </option>
          {categories.map((item) => (
            <option key={item.id} value={item.id}>
              {item.label}
            </option>
          ))}
        </Select>
      </Label>
      {category &&
        spec.parameters.map((parameter) => {
          const name = templateLabel(parameter.template.observation_id, parameter.template.pk)
          const dropped = draft.drop.includes(parameter.template.pk)
          return (
            <div key={parameter.template.pk}>
              <Label>
                {name} in {category.label}
                <Select
                  value={draft.mappings[parameter.template.pk] ?? ''}
                  disabled={disabled || busy || dropped}
                  onChange={(event) =>
                    setDraft({
                      ...draft,
                      mappings: { ...draft.mappings, [parameter.template.pk]: event.target.value },
                    })
                  }
                >
                  <option value="">Choose a mapping…</option>
                  {mappingsFor(batch, category.pk, parameter.template.pk).map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.label}
                    </option>
                  ))}
                </Select>
              </Label>
              <CheckboxLabel>
                <input
                  type="checkbox"
                  checked={dropped}
                  disabled={disabled || busy}
                  onChange={(event) =>
                    setDraft({
                      ...draft,
                      drop: event.target.checked
                        ? [...draft.drop, parameter.template.pk]
                        : draft.drop.filter((item) => item !== parameter.template.pk),
                    })
                  }
                />
                Drop {name}
              </CheckboxLabel>
            </div>
          )
        })}
      <SaveRow
        label="Save category"
        disabled={disabled || !category}
        busy={busy}
        problem={problem}
        retry={retry}
        onSave={submit}
      />
      <Small>Creating a category is not supported yet.</Small>
    </Fieldset>
  )
}

/** Passes each field's draft state on, and keeps whether any of this editor's own is unsaved. */
function useOwnDrafts(report: (source: string) => (dirty: boolean) => void) {
  const [dirtySources, setDirtySources] = useState<ReadonlySet<string>>(new Set())
  const callbacks = useRef(new Map<string, (dirty: boolean) => void>())
  const reportFor = useCallback(
    (source: string) => {
      let callback = callbacks.current.get(source)
      if (!callback) {
        const outer = report(source)
        callback = (dirty: boolean) => {
          outer(dirty)
          setDirtySources((current) => {
            if (current.has(source) === dirty) {
              return current
            }
            const next = new Set(current)
            if (dirty) {
              next.add(source)
            } else {
              next.delete(source)
            }
            return next
          })
        }
        callbacks.current.set(source, callback)
      }
      return callback
    },
    [report],
  )
  return { dirty: dirtySources.size > 0, reportFor }
}
