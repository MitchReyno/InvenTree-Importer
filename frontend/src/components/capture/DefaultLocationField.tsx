import { useRef, useState } from 'react'
import styled from 'styled-components'
import { space } from '#/theme/generated/tokens'
import type {
  CatalogueRecordDto,
  CaptureDefaultLocationSettingDto,
  CaptureReferenceDraftDto,
} from '@invimport/contracts'
import type { CaptureWorkspaceProps, Snapshot } from '#/capture/types'
import { referenceLabel } from '#/capture/settings-model'
import { useIntentTicket } from '#/capture/useIntentTicket'
import type { useCatalogue } from '#/catalogue/useCatalogue'
import {
  SearchableReferencePicker,
  Field,
  Input,
  Label,
  Small,
  Subheading,
  Button,
} from '#/components/ui'

type LocationDraft = Extract<CaptureReferenceDraftDto, { kind: 'location' }>
type Catalogue = ReturnType<typeof useCatalogue>

type Props = {
  batch: Snapshot
  value: CaptureDefaultLocationSettingDto
  drafts: CaptureReferenceDraftDto[]
  /** Reads drafts at apply time, so a late result never replaces drafts made meanwhile. */
  currentDrafts: () => CaptureReferenceDraftDto[]
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
  currentDrafts,
  catalogue,
  observe,
  disabled,
  onChange,
  onTextEdit,
}: Props) {
  const [problem, setProblem] = useState('')
  // Selection and parent choices are ordered separately; typing a draft name supersedes neither.
  const selection = useIntentTicket()
  const parentChoice = useIntentTicket()
  const latestValue = useRef(value)
  latestValue.current = value
  const draft =
    value.mode === 'draft'
      ? (drafts.find((item) => item.draft_id === value.draft_id) as LocationDraft | undefined)
      : undefined

  function select(next: CaptureDefaultLocationSettingDto, nextDrafts: CaptureReferenceDraftDto[]) {
    selection.take()
    onChange(next, nextDrafts)
  }

  /** Resolves to null when observation fails or a newer intent superseded this choice. */
  async function observed(record: CatalogueRecordDto, intent: ReturnType<typeof useIntentTicket>) {
    setProblem('')
    const ticket = intent.take()
    const observation = await observe('location', record.pk)
    if (!intent.isCurrent(ticket)) {
      return null
    }
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
    const reference = await observed(record, selection)
    if (reference) {
      onChange({ mode: 'set', value: reference }, currentDrafts())
    }
  }

  function create(name: string) {
    const next: LocationDraft = {
      draft_id: crypto.randomUUID(),
      kind: 'location',
      value: { name, description: '', parent: null },
    }
    select({ mode: 'draft', draft_id: next.draft_id }, [...drafts, next])
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
    const draftId = draft?.draft_id
    const reference = await observed(record, parentChoice)
    if (!reference) {
      return
    }
    // Apply to the draft as it is now, keeping any name or description typed meanwhile.
    onChange(
      latestValue.current,
      currentDrafts().map((item) =>
        item.draft_id === draftId && item.kind === 'location'
          ? { ...item, value: { ...item.value, parent: reference } }
          : item,
      ),
    )
  }

  const selected =
    value.mode === 'set'
      ? { pk: value.value.pk, label: referenceLabel(batch, value.value.observation_id) }
      : null
  const parent = draft?.value.parent

  return (
    <FieldStack>
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
            <Button
              type="button"
              disabled={disabled}
              onClick={() => {
                parentChoice.take()
                editDraft({ parent: null })
              }}
            >
              No parent location
            </Button>
          )}
          <Small>
            Saved as a pending request. Nothing is created from this form; it is created only after
            you approve it in Review, on a target that supports new records.
          </Small>
        </Field>
      )}
      {(value.mode === 'set' || value.mode === 'draft') && (
        <Button type="button" disabled={disabled} onClick={() => select({ mode: 'unset' }, drafts)}>
          Remove default location
        </Button>
      )}
    </FieldStack>
  )
}

const FieldStack = styled.div`
  display: grid;
  gap: ${space[4]};
  min-width: 0;
`
