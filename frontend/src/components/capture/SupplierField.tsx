import { useState } from 'react'
import styled from 'styled-components'
import { space } from '#/theme/generated/tokens'
import type {
  CatalogueRecordDto,
  CaptureReferenceDraftDto,
  CaptureSettingsIntentDto,
} from '@invimport/contracts'
import type { CaptureWorkspaceProps, Snapshot } from '#/capture/types'
import { referenceLabel } from '#/capture/settings-model'
import { useIntentTicket } from '#/capture/useIntentTicket'
import type { useCatalogue } from '#/catalogue/useCatalogue'
import { DisabledFeature, Small, Subheading } from '#/components/ui'
import { SearchableReferencePicker, CheckboxLabel, Field, Input, Label } from '#/forms'

type Supplier = CaptureSettingsIntentDto['supplier']
type CompanyDraft = Extract<CaptureReferenceDraftDto, { kind: 'company' }>
type Catalogue = ReturnType<typeof useCatalogue>

export type LogoUpload = { state: 'idle' | 'uploading' | 'failed'; message?: string }

type Props = {
  batch: Snapshot
  value: Supplier
  drafts: CaptureReferenceDraftDto[]
  /** Reads drafts at apply time, so a late result never replaces drafts made meanwhile. */
  currentDrafts: () => CaptureReferenceDraftDto[]
  catalogue: Catalogue
  observe: CaptureWorkspaceProps['observe']
  disabled: boolean
  logo: LogoUpload
  onUploadLogo?: (file: File, draftId: string) => void
  onChange: (value: Supplier, drafts: CaptureReferenceDraftDto[]) => void
  onTextEdit: () => void
}

const LOGO_EXPLANATION =
  'Automatic logo discovery is coming soon. Upload a PNG or JPEG logo manually for now.'

/** No supplier records absence while keeping the selection or draft for unchecking later. */
export function SupplierField({
  batch,
  value,
  drafts,
  currentDrafts,
  catalogue,
  observe,
  disabled,
  logo,
  onUploadLogo,
  onChange,
  onTextEdit,
}: Props) {
  const [problem, setProblem] = useState('')
  // Each selection or absence change supersedes a pending observation; draft text does not.
  const intent = useIntentTicket()
  const selection = value.selection
  const draft =
    selection.mode === 'draft'
      ? (drafts.find((item) => item.draft_id === selection.draft_id) as CompanyDraft | undefined)
      : undefined

  function emit(next: Supplier, nextDrafts: CaptureReferenceDraftDto[]) {
    intent.take()
    onChange(next, nextDrafts)
  }

  async function choose(record: CatalogueRecordDto) {
    setProblem('')
    const ticket = intent.take()
    const observation = await observe('company', record.pk)
    if (!intent.isCurrent(ticket)) {
      return
    }
    if (!observation || observation.mapping?.kind !== 'company' || !observation.mapping.supplier) {
      setProblem('The selected supplier could not be confirmed. The previous choice is kept.')
      return
    }
    onChange(
      {
        absent: false,
        selection: {
          mode: 'existing',
          reference: {
            observation_id: observation.id,
            target_context_id: observation.target_context_id,
            model: 'company',
            pk: observation.pk,
          },
        },
      },
      currentDrafts(),
    )
  }

  function create(name: string) {
    const next: CompanyDraft = {
      draft_id: crypto.randomUUID(),
      kind: 'company',
      value: { name, description: '', also_manufacturer: false, logo: null },
    }
    emit({ absent: false, selection: { mode: 'draft', draft_id: next.draft_id } }, [
      ...drafts,
      next,
    ])
  }

  function editDraft(change: Partial<CompanyDraft['value']>) {
    if (!draft) {
      return
    }
    const next = { ...draft, value: { ...draft.value, ...change } }
    onChange(
      value,
      drafts.map((item) => (item.draft_id === draft.draft_id ? next : item)),
    )
  }

  const selected =
    selection.mode === 'existing'
      ? {
          pk: selection.reference.pk,
          label: referenceLabel(batch, selection.reference.observation_id),
        }
      : null
  const draftDisabled = disabled || value.absent

  return (
    <FieldStack>
      <CheckboxLabel>
        <input
          type="checkbox"
          checked={value.absent}
          disabled={disabled}
          onChange={(event) => emit({ ...value, absent: event.target.checked }, drafts)}
        />
        No supplier
      </CheckboxLabel>
      <SearchableReferencePicker
        label="Supplier"
        noun="suppliers"
        value={selected}
        candidates={catalogue.candidates}
        coverage={catalogue.coverage}
        status={catalogue.status}
        search={catalogue.search}
        onChange={(record) => void choose(record)}
        onCreate={create}
        createLabel="New supplier"
        disabled={draftDisabled}
        disabledReason={
          value.absent
            ? 'No supplier is recorded. Uncheck No supplier to restore the choice.'
            : undefined
        }
      />
      {problem && <Small role="alert">{problem}</Small>}
      {draft && (
        <Field role="group" aria-labelledby="new-supplier-title">
          <Subheading id="new-supplier-title">New supplier · not created yet</Subheading>
          <Label>
            Supplier name
            <Input
              required
              maxLength={100}
              disabled={draftDisabled}
              value={draft.value.name}
              onChange={(event) => {
                onTextEdit()
                editDraft({ name: event.target.value })
              }}
            />
          </Label>
          <Label>
            Supplier description
            <Input
              maxLength={250}
              disabled={draftDisabled}
              value={draft.value.description}
              onChange={(event) => {
                onTextEdit()
                editDraft({ description: event.target.value })
              }}
            />
          </Label>
          <CheckboxLabel>
            <input
              type="checkbox"
              checked={draft.value.also_manufacturer}
              disabled={draftDisabled}
              onChange={(event) => editDraft({ also_manufacturer: event.target.checked })}
            />
            Also set as manufacturer
          </CheckboxLabel>
          <Label>
            Supplier logo (optional)
            <Input
              type="file"
              accept="image/png,image/jpeg"
              disabled={draftDisabled || !onUploadLogo || logo.state === 'uploading'}
              onChange={(event) => {
                const file = event.target.files?.[0]
                if (file && onUploadLogo) {
                  onUploadLogo(file, draft.draft_id)
                }
                event.target.value = ''
              }}
            />
          </Label>
          <Small role={logo.state === 'failed' ? 'alert' : undefined}>
            {logo.state === 'uploading'
              ? 'Uploading logo…'
              : logo.state === 'failed'
                ? logo.message
                : draft.value.logo
                  ? 'Logo uploaded and retained with this batch.'
                  : onUploadLogo
                    ? 'No logo uploaded.'
                    : 'Logo upload is unavailable.'}
          </Small>
          {draft.value.logo && (
            <CheckboxLabel>
              <input
                type="checkbox"
                checked
                disabled={draftDisabled}
                onChange={() => editDraft({ logo: null })}
              />
              Use uploaded logo
            </CheckboxLabel>
          )}
          <DisabledFeature label="Find automatically" explanation={LOGO_EXPLANATION} />
          <Small>
            Saved as a pending request. Nothing is created from this form; it is created only after
            you approve it in Review, on a target that supports new records.
          </Small>
        </Field>
      )}
    </FieldStack>
  )
}

const FieldStack = styled.div`
  display: grid;
  gap: ${space[4]};
  min-width: 0;
`
