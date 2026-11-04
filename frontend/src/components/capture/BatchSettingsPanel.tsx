import { useEffect, useRef, useState } from 'react'
import { Controller, useForm } from 'react-hook-form'
import styled from 'styled-components'
import type {
  CaptureBatchSettingsChangeDto,
  CaptureDefaultLocationSettingDto,
  CaptureReferenceDraftDto,
  MediaReceiptDto,
  OperatorReviewDto,
} from '@invimport/contracts'
import type { CaptureWorkspaceProps, SettingsPorts, Snapshot } from '../../capture/types'
import { settingsChange, settingsValues, type SettingsValues } from '../../capture/settings-model'
import type { QueueState } from '../../capture/save-queue'
import { useSaveQueue } from '../../capture/useSaveQueue'
import { useCatalogue } from '../../catalogue/useCatalogue'
import { AutosaveStatus, type AutosaveState } from '../ui/AutosaveStatus'
import { OptionalNotesField } from '../ui/OptionalNotesField'
import { SharedTagsInput } from '../ui/SharedTagsInput'
import {
  Fieldset,
  Form,
  Heading,
  Input,
  Label,
  Link,
  Panel,
  Paragraph,
  Small,
  TextArea,
} from '../ui/primitives'
import { CaptureContextSummary } from './CaptureContextSummary'
import { DefaultLocationField } from './DefaultLocationField'
import { PurchaseOrderPreview } from './PurchaseOrderPreview'
import { SupplierField, type LogoUpload } from './SupplierField'

type Props = Pick<CaptureWorkspaceProps, 'observe' | 'reload' | 'operatorReview'> & {
  batch: Snapshot
  ports?: SettingsPorts
  /** An evidence change is pending; settings wait so the two commands cannot race. */
  paused?: boolean
  onDirty: (dirty: boolean) => void
}

type LogoPayload = { upload_id: string; draft_id: string }
type LogoResult = { receipt: MediaReceiptDto; draftId: string }

const MAX_INSTRUCTION_CHARACTERS = 8192

const latestInstructions = (review: OperatorReviewDto | undefined) =>
  review?.instructions.find((item) => item.group_id === null)

const newer = (candidate: string, current: string) => BigInt(candidate) > BigInt(current)

function laneState(state: QueueState, lane: string): AutosaveState {
  const status = state.lanes[lane] ?? 'saved'
  if (!state.connected && status !== 'saved') {
    return 'disconnected'
  }
  return status
}

/**
 * Batch settings autosave. Valid edits are sent through one per-batch serialized queue after an
 * idle debounce or blur; Custom instructions use their own command in the same queue.
 */
export function BatchSettingsPanel({
  batch,
  ports,
  paused = false,
  operatorReview,
  observe,
  reload,
  onDirty,
}: Props) {
  const initial = useRef(settingsValues(batch))
  const [queue, state] = useSaveQueue(batch.revision)
  const { control, register, getValues, setValue, reset, watch } = useForm<SettingsValues>({
    defaultValues: initial.current,
  })
  const instructionRecord = latestInstructions(operatorReview)
  const [instructions, setInstructions] = useState(instructionRecord?.text ?? '')
  const [logo, setLogo] = useState<LogoUpload>({ state: 'idle' })
  const composing = useRef(false)
  const textEdit = useRef(false)
  const files = useRef(new Map<string, File>())
  const wasConnected = useRef(ports?.connected ?? false)
  const connected = ports?.connected ?? false
  const editable = ports !== undefined && connected && !batch.archived && !paused
  const locations = useCatalogue(ports?.catalogue, batch.id, 'location', editable)
  const suppliers = useCatalogue(ports?.catalogue, batch.id, 'supplier', editable)
  const values = watch()

  useEffect(() => {
    if (!ports) {
      return
    }
    queue.register<CaptureBatchSettingsChangeDto | null, Snapshot>(
      'settings',
      {
        send: (change, revision, key) => ports.save(change!, revision, key),
        revisionOf: (snapshot) => snapshot.revision,
        onAcknowledged: (snapshot) => ports.accept(snapshot),
      },
      settingsChange(initial.current),
    )
    const instruct = ports.instruct
    if (instruct && operatorReview) {
      queue.register<string, OperatorReviewDto>(
        'instructions',
        {
          send: (text, revision, key) => instruct(text, revision, key),
          revisionOf: (review) => review.revision,
          onAcknowledged: (review) => void adoptRead(review.revision),
        },
        instructionRecord?.text ?? '',
      )
    }
    const upload = ports.uploadLogo
    if (upload) {
      queue.register<LogoPayload | null, LogoResult>(
        'logo',
        {
          send: async (payload, revision, key) => ({
            receipt: await upload(
              files.current.get(payload!.upload_id)!,
              'Supplier logo',
              revision,
              key,
            ),
            draftId: payload!.draft_id,
          }),
          // Every retained command advances the batch revision by exactly one.
          revisionOf: (_result, revision) => (BigInt(revision) + 1n).toString(),
          onAcknowledged: (result) => attachLogo(result),
        },
        null,
      )
    }
  })

  useEffect(() => {
    onDirty(state.dirty)
  }, [onDirty, state.dirty])

  useEffect(() => {
    if (state.blocked === 'unconfirmed' && state.lanes.logo === 'pending') {
      setLogo({
        state: 'failed',
        message: 'Logo upload not confirmed. Retry the same upload or reload saved values.',
      })
    }
  }, [state.blocked, state.lanes.logo])

  // A clean editor follows newer saved values; a dirty one keeps its draft for explicit handling.
  useEffect(() => {
    if (!state.dirty && newer(batch.revision, state.revision)) {
      const next = settingsValues(batch)
      queue.reset(batch.revision, {
        settings: settingsChange(next),
        instructions: latestInstructions(operatorReview)?.text ?? '',
      })
      reset(next)
      setInstructions(latestInstructions(operatorReview)?.text ?? '')
    }
  }, [batch, operatorReview, queue, reset, state.dirty, state.revision])

  useEffect(() => {
    if (!ports) {
      return
    }
    if (!connected) {
      wasConnected.current = false
      queue.setConnected(false)
      return
    }
    if (wasConnected.current) {
      queue.setConnected(true)
      return
    }
    wasConnected.current = true
    let current = true
    // Reconnection reads current state before admitting writes; it never replays blindly.
    ports.read().then(
      (snapshot) => {
        if (current) {
          ports.accept(snapshot)
          queue.setConnected(true)
        }
      },
      () => {
        if (current) {
          wasConnected.current = false
        }
      },
    )
    return () => {
      current = false
    }
  }, [connected, ports, queue])

  async function adoptRead(revision: string) {
    try {
      const snapshot = await ports!.read()
      if (!newer(revision, snapshot.revision)) {
        ports!.accept(snapshot)
      }
    } catch {
      // The queue already holds the acknowledged revision; the next read reconciles the view.
    }
  }

  function schedule() {
    const immediate = !textEdit.current
    textEdit.current = false
    onDirty(true)
    if (composing.current) {
      return
    }
    const change = settingsChange(getValues())
    if (change) {
      queue.update('settings', change, { immediate })
    } else {
      queue.invalid('settings')
    }
  }

  function scheduleText() {
    textEdit.current = true
    schedule()
  }

  function updateInstructions(text: string) {
    setInstructions(text)
    onDirty(true)
    if (composing.current) {
      return
    }
    if ([...text].length > MAX_INSTRUCTION_CHARACTERS) {
      queue.invalid('instructions')
    } else {
      queue.update('instructions', text)
    }
  }

  function setLocation(
    value: CaptureDefaultLocationSettingDto,
    drafts: CaptureReferenceDraftDto[],
  ) {
    setValue('defaultLocation', value)
    setValue('drafts', drafts)
    schedule()
  }

  function uploadLogo(file: File, draftId: string) {
    const upload_id = crypto.randomUUID()
    files.current.set(upload_id, file)
    setLogo({ state: 'uploading' })
    onDirty(true)
    queue.update('logo', { upload_id, draft_id: draftId }, { immediate: true })
  }

  function attachLogo({ receipt, draftId }: LogoResult) {
    setLogo({ state: 'idle' })
    const drafts = getValues('drafts').map((draft) =>
      draft.draft_id === draftId && draft.kind === 'company'
        ? {
            ...draft,
            value: {
              ...draft.value,
              logo: { evidence_id: receipt.evidence_id, version_id: receipt.version.id },
            },
          }
        : draft,
    )
    setValue('drafts', drafts)
    schedule()
  }

  async function keepEdits() {
    try {
      const snapshot = await ports!.read()
      ports!.accept(snapshot)
      queue.rebase(snapshot.revision)
    } catch {
      // Remain blocked; the alert stays visible with its recovery actions.
    }
  }

  function flushAll() {
    if (composing.current) {
      return
    }
    queue.flush('settings')
    if (state.lanes.instructions) {
      queue.flush('instructions')
    }
  }

  const titleInvalid = !values.title.trim()
  const settingsStatus = laneState(state, 'settings')

  return (
    <Settings role="region" aria-labelledby="batch-settings-title" data-area="settings">
      <Heading id="batch-settings-title">Batch settings</Heading>
      {!ports && <Paragraph role="status">Settings editing is unavailable in this view.</Paragraph>}
      {ports && !connected && (
        <Paragraph role="status">
          Application connection unavailable. Settings are read-only until it returns; unsaved edits
          stay on this page.
        </Paragraph>
      )}
      {paused && (
        <Paragraph role="status">
          Finish or discard the evidence change to continue editing settings.
        </Paragraph>
      )}
      {state.blocked === 'conflict' && (
        <AutosaveStatus
          label="Batch settings"
          state="conflict"
          revision={state.revision}
          onReload={reload}
        />
      )}
      {state.blocked === 'conflict' && (
        <KeepButton type="button" onClick={() => void keepEdits()}>
          Keep my edits and save them over the newer version
        </KeepButton>
      )}
      {state.blocked === 'unconfirmed' && (
        <AutosaveStatus
          label="Batch settings"
          state="unconfirmed"
          revision={state.revision}
          onRetry={connected ? () => queue.retry() : undefined}
          onReload={reload}
        />
      )}
      <Form
        onSubmit={(event) => event.preventDefault()}
        onBlur={flushAll}
        onCompositionStart={() => {
          composing.current = true
        }}
        onCompositionEnd={() => {
          composing.current = false
          scheduleText()
        }}
      >
        <Fieldset disabled={!editable}>
          <Label>
            Batch title
            <Input
              required
              maxLength={256}
              aria-invalid={titleInvalid || undefined}
              aria-describedby={titleInvalid ? 'batch-title-error' : undefined}
              {...register('title', { onChange: scheduleText })}
            />
          </Label>
          {titleInvalid && (
            <Small id="batch-title-error" role="alert">
              Enter a batch title. The previous title stays saved until then.
            </Small>
          )}
          <Controller
            name="batchNote"
            control={control}
            render={({ field }) => (
              <OptionalNotesField
                toggleLabel="Add batch notes"
                label="Batch notes"
                value={field.value}
                disabled={!editable}
                onChange={(value) => {
                  field.onChange(value)
                  if (value === null) {
                    schedule()
                  } else {
                    scheduleText()
                  }
                }}
              />
            )}
          />
          <DefaultLocationField
            batch={batch}
            value={values.defaultLocation}
            drafts={values.drafts}
            catalogue={locations}
            observe={observe}
            disabled={!editable}
            onChange={setLocation}
            onTextEdit={() => {
              textEdit.current = true
            }}
          />
          <SupplierField
            batch={batch}
            value={values.intent.supplier}
            drafts={values.drafts}
            catalogue={suppliers}
            observe={observe}
            disabled={!editable}
            logo={logo}
            onUploadLogo={ports?.uploadLogo ? uploadLogo : undefined}
            onChange={(supplier, drafts) => {
              setValue('intent.supplier', supplier)
              setValue('drafts', drafts)
              schedule()
            }}
            onTextEdit={() => {
              textEdit.current = true
            }}
          />
          <PurchaseOrderPreview order={values.intent.order} orderNote={values.orderNote} />
          <Controller
            name="intent.shared_tags"
            control={control}
            render={({ field }) => (
              <SharedTagsInput
                value={field.value}
                disabled={!editable}
                onChange={(value) => {
                  field.onChange(value)
                  schedule()
                }}
              />
            )}
          />
          <AutosaveStatus label="Batch settings" state={settingsStatus} revision={state.revision} />
          {state.lanes.instructions && (
            <Instructions>
              <Label>
                Custom instructions
                <TextArea
                  value={instructions}
                  maxLength={MAX_INSTRUCTION_CHARACTERS * 2}
                  onChange={(event) => updateInstructions(event.target.value)}
                />
              </Label>
              <Small>
                {instructionRecord
                  ? `Version ${instructionRecord.version} · ${new Date(instructionRecord.created_at).toLocaleString()}`
                  : 'No custom instructions saved yet.'}{' '}
                Versioned human context for research; instructions do not approve inventory values.
              </Small>
              <AutosaveStatus
                label="Custom instructions"
                state={laneState(state, 'instructions')}
                revision={state.revision}
              />
            </Instructions>
          )}
        </Fieldset>
      </Form>
      <details>
        <summary>Saved lot inheritance and overrides · {batch.lots.length} physical lots</summary>
        {batch.lots.map((lot) => (
          <div key={lot.id}>
            <Link href={`#${batch.id}/review/${lot.id}`}>{lot.label}</Link>
            <CaptureContextSummary batch={batch} subjectId={lot.id} />
            <Small>
              Location:{' '}
              {lot.location.mode === 'inherit' ? 'Inherited from Default location' : 'Lot override'}
            </Small>
          </div>
        ))}
      </details>
    </Settings>
  )
}

const Settings = styled(Panel)`
  min-width: 0;
  margin-bottom: 0;
  details {
    margin-top: 12px;
    overflow-wrap: anywhere;
  }
`
const Instructions = styled.div`
  display: grid;
  gap: 8px;
  padding-top: 12px;
  border-top: 1px solid #e3e8ef;
`
const KeepButton = styled.button`
  min-height: 44px;
  margin: 8px 0 12px;
  padding: 9px 14px;
  color: #164a93;
  background: #edf3fc;
  border: 1px solid #b9cde7;
  border-radius: 6px;
  cursor: pointer;
`
