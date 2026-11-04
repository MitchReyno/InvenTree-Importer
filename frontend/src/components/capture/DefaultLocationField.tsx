import { useState } from 'react'
import type {
  CatalogueRecordDto,
  CaptureDefaultLocationSettingDto,
  CaptureReferenceDraftDto,
} from '@invimport/contracts'
import type { CaptureWorkspaceProps, Snapshot } from '../../capture/types'
import { referenceLabel } from '../../capture/settings-model'
import type { useCatalogue } from '../../catalogue/useCatalogue'
import { SearchableReferencePicker } from '../ui/SearchableReferencePicker'
import { Button, Field, Input, Label, Small, Subheading } from '../ui/primitives'

type LocationDraft = Extract<CaptureReferenceDraftDto, { kind: 'location' }>
type Catalogue = ReturnType<typeof useCatalogue>

type Props = {
  batch: Snapshot
  value: CaptureDefaultLocationSettingDto
  drafts: CaptureReferenceDraftDto[]
  catalogue: Catalogue
  observe: CaptureWorkspaceProps['observe']
  disabled: boolean
  onChange: (value: CaptureDefaultLocationSettingDto, drafts: CaptureReferenceDraftDto[]) => void
  onTextEdit: () => void
}

const legacyText = {
  unknown: 'Saved as explicitly unknown. Search to choose a location.',
  clear: 'Saved as explicitly no location. Search to choose a location.',
} as const

/** One optional Default location: an observed existing record or a pending new-location draft. */
export function DefaultLocationField({
  batch,
  value,
  drafts,
  catalogue,
  observe,
  disabled,
  onChange,
  onTextEdit,
}: Props) {
  const [problem, setProblem] = useState('')
  const draft =
    value.mode === 'draft'
      ? (drafts.find((item) => item.draft_id === value.draft_id) as LocationDraft | undefined)
      : undefined

  async function observed(record: CatalogueRecordDto) {
    setProblem('')
    const observation = await observe('location', record.pk)
    if (!observation) {
      setProblem('The selected location could not be confirmed. The previous choice is kept.')
      return null
    }
    return {
      observation_id: observation.id,
      target_context_id: observation.target_context_id,
      model: 'location' as const,
      pk: observation.pk,
    }
  }

  async function choose(record: CatalogueRecordDto) {
    const reference = await observed(record)
    if (reference) {
      onChange({ mode: 'set', value: reference }, drafts)
    }
  }

  function create(name: string) {
    const next: LocationDraft = {
      draft_id: crypto.randomUUID(),
      kind: 'location',
      value: { name, description: '', parent: null },
    }
    onChange({ mode: 'draft', draft_id: next.draft_id }, [...drafts, next])
  }

  function editDraft(change: Partial<LocationDraft['value']>) {
    if (!draft) {
      return
    }
    const next = { ...draft, value: { ...draft.value, ...change } }
    onChange(
      value,
      drafts.map((item) => (item.draft_id === draft.draft_id ? next : item)),
    )
  }

  async function chooseParent(record: CatalogueRecordDto) {
    const reference = await observed(record)
    if (reference) {
      editDraft({ parent: reference })
    }
  }

  const selected =
    value.mode === 'set'
      ? { pk: value.value.pk, label: referenceLabel(batch, value.value.observation_id) }
      : null
  const parent = draft?.value.parent

  return (
    <Field>
      <SearchableReferencePicker
        label="Default location"
        noun="locations"
        value={selected}
        candidates={catalogue.candidates}
        coverage={catalogue.coverage}
        status={catalogue.status}
        search={catalogue.search}
        onChange={(record) => void choose(record)}
        onCreate={create}
        createLabel="New location"
        disabled={disabled}
      />
      {(value.mode === 'unknown' || value.mode === 'clear') && (
        <Small>{legacyText[value.mode]}</Small>
      )}
      {problem && <Small role="alert">{problem}</Small>}
      {draft && (
        <Field role="group" aria-labelledby="new-location-title">
          <Subheading id="new-location-title">New location · not created yet</Subheading>
          <Label>
            Location name
            <Input
              required
              maxLength={100}
              disabled={disabled}
              value={draft.value.name}
              onChange={(event) => {
                onTextEdit()
                editDraft({ name: event.target.value })
              }}
            />
          </Label>
          <Label>
            Location description
            <Input
              maxLength={250}
              disabled={disabled}
              value={draft.value.description}
              onChange={(event) => {
                onTextEdit()
                editDraft({ description: event.target.value })
              }}
            />
          </Label>
          <SearchableReferencePicker
            label="Parent location"
            noun="locations"
            value={
              parent ? { pk: parent.pk, label: referenceLabel(batch, parent.observation_id) } : null
            }
            candidates={catalogue.candidates}
            coverage={catalogue.coverage}
            status={catalogue.status}
            search={catalogue.search}
            onChange={(record) => void chooseParent(record)}
            disabled={disabled}
          />
          {parent && (
            <Button type="button" disabled={disabled} onClick={() => editDraft({ parent: null })}>
              No parent location
            </Button>
          )}
          <Small>
            Saved as a pending request for review. Nothing is created in inventory from this form.
          </Small>
        </Field>
      )}
      {(value.mode === 'set' || value.mode === 'draft') && (
        <Button
          type="button"
          disabled={disabled}
          onClick={() => onChange({ mode: 'unset' }, drafts)}
        >
          Remove default location
        </Button>
      )}
    </Field>
  )
}
