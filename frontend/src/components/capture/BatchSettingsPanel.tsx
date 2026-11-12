import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Controller, useForm } from 'react-hook-form'
import styled from 'styled-components'
import { color, size, space } from '#/theme/generated/tokens'
import {
  media,
  AutosaveStatus,
  type AutosaveState,
  Heading,
  Link,
  Panel,
  Small,
  Banner,
  Button,
} from '#/components/ui'
import { TextField, SharedTagsInput, Fieldset, Form, Input, Label, TextArea } from '#/forms'
import type {
  CaptureBatchSettingsChangeDto,
  CaptureDefaultLocationSettingDto,
  CaptureReferenceDraftDto,
  MediaReceiptDto,
  OperatorReviewDto,
} from '@invimport/contracts'
import type {
  CaptureObserve,
  CaptureWorkspaceProps,
  SettingsPorts,
  Snapshot,
} from '#/capture/types'
import {
  referenceLabel,
  settingsChange,
  settingsValues,
  type SettingsValues,
} from '#/capture/settings-model'
import type { QueueState } from '#/capture/save-queue'
import { useSaveQueue } from '#/capture/useSaveQueue'
import { useCatalogue } from '#/catalogue/useCatalogue'
import { DefaultLocationField } from './DefaultLocationField'
import { PurchaseOrderPreview } from './PurchaseOrderPreview'
import { SupplierField, type LogoUpload } from './SupplierField'
import { batchHref } from '#/navigation/batch-route'

type Props = Pick<CaptureWorkspaceProps, 'operatorReview'> & {
  observe: CaptureObserve
  reload?: () => Promise<void>
  batch: Snapshot
  ports?: SettingsPorts
  /** An evidence change is pending; settings wait so the two commands cannot race. */
  paused?: boolean
  /** Where the batch notes field is drawn; Capture puts it in the evidence card. */
  notesTarget?: HTMLElement | null
  /** On a phone the fields fold behind a summary; folded fields stay mounted, keeping drafts. */
  collapsible?: boolean
  onDirty: (dirty: boolean) => void
}

type LogoPayload = { upload_id: string; draft_id: string }
type LogoResult = { receipt: MediaReceiptDto; draftId: string }

const MAX_INSTRUCTION_CHARACTERS = 8192
const RECONCILE_RETRY_MS = 2000
const LOGO_UNCONFIRMED = 'Logo upload not confirmed. Retry the same upload or reload saved values.'
const LOGO_REFUSED = 'The logo was refused. Choose a PNG or JPEG image within the size limit.'

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
  notesTarget,
  collapsible = false,
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
  const [composingText, setComposingText] = useState(false)
  const [tagPending, setTagPending] = useState(false)
  // Remounting the tag input clears text typed but not yet added.
  const [tagInput, setTagInput] = useState(0)
  const textEdit = useRef(false)
  const instructionsTouched = useRef(false)
  const files = useRef(new Map<string, File>())
  const connected = ports?.connected ?? false
  // The mounting read is current; only a later reconnection must reconcile before writes.
  const reconciled = useRef(connected)
  const [readAttempt, setReadAttempt] = useState(0)
  const editable = ports !== undefined && connected && !batch.archived && !paused
  const locations = useCatalogue(ports?.catalogue, batch.id, 'location', editable)
  const suppliers = useCatalogue(ports?.catalogue, batch.id, 'supplier', editable)
  const values = watch()

  // Batch rebuilds its ports on every render, so Effects read the latest through these refs.
  const instructionText = instructionRecord?.text ?? ''
  const latest = useRef({ ports, adoptRead, attachLogo, instructionText })
  useEffect(() => {
    latest.current = { ports, adoptRead, attachLogo, instructionText }
  })
  const hasPorts = ports !== undefined
  const instructionLane = Boolean(ports?.instruct) && operatorReview !== undefined
  const logoLane = Boolean(ports?.uploadLogo)

  // Registers the save queue's lanes; each lane's spec reads the latest ports when it sends.
  useEffect(() => {
    if (!hasPorts) {
      return
    }
    queue.register<CaptureBatchSettingsChangeDto | null, Snapshot>(
      'settings',
      {
        send: (change, revision, key) => latest.current.ports!.save(change!, revision, key),
        revisionOf: (snapshot) => snapshot.revision,
        onAcknowledged: (snapshot) => latest.current.ports!.accept(snapshot),
      },
      settingsChange(initial.current),
    )
    if (instructionLane) {
      queue.register<string, OperatorReviewDto>(
        'instructions',
        {
          send: (text, revision, key) => latest.current.ports!.instruct!(text, revision, key),
          revisionOf: (review) => review.revision,
          onAcknowledged: (review) => void latest.current.adoptRead(review.revision),
        },
        latest.current.instructionText,
      )
    }
    if (logoLane) {
      queue.register<LogoPayload | null, LogoResult>(
        'logo',
        {
          send: async (payload, revision, key) => ({
            receipt: await latest.current.ports!.uploadLogo!(
              files.current.get(payload!.upload_id)!,
              'Supplier logo',
              revision,
              key,
            ),
            draftId: payload!.draft_id,
          }),
          // Every retained command advances the batch revision by exactly one.
          revisionOf: (_result, revision) => (BigInt(revision) + 1n).toString(),
          onAcknowledged: (result) => latest.current.attachLogo(result),
          onRejected: () => {
            setLogo({ state: 'failed', message: LOGO_REFUSED })
            queue.discard('logo')
          },
        },
        null,
      )
    }
    // The registration-time saved values are read once; later changes go through adoption.
  }, [queue, hasPorts, instructionLane, logoLane])

  useEffect(() => {
    onDirty(state.dirty || composingText || tagPending)
  }, [composingText, onDirty, state.dirty, tagPending])

  const shownLogo: LogoUpload =
    state.blocked === 'unconfirmed' && state.lanes.logo === 'pending'
      ? { state: 'failed', message: LOGO_UNCONFIRMED }
      : logo

  // Instructions can arrive after Capture. A new saved version becomes the lane's acknowledged
  // baseline; the textbox follows it until the operator types, otherwise the draft is compared again.
  const instructionVersion = instructionRecord?.version
  const savedInstructions = operatorReview
    ? (latestInstructions(operatorReview)?.text ?? '')
    : undefined
  useEffect(() => {
    if (savedInstructions === undefined) {
      return
    }
    const text = savedInstructions
    // A clean lane (no draft, nothing unacknowledged) follows the newer saved text without sending;
    // an outstanding draft or a composition in progress keeps the operator's text.
    const clean = queue.adoptSaved('instructions', text)
    if ((clean || !instructionsTouched.current) && !composing.current) {
      instructionsTouched.current = false
      setInstructions(text)
    }
    // Only a new saved version (or the projection's first arrival) is adopted.
  }, [instructionVersion, savedInstructions, queue])

  // A clean editor follows newer saved values; a dirty one keeps its draft for explicit handling.
  useEffect(() => {
    // Composed text has not reached the queue yet, so composition also keeps the draft.
    if (!state.dirty && !composingText && newer(batch.revision, state.revision)) {
      const next = settingsValues(batch)
      // Unavailable instructions are not confirmed empty: keep their baseline until a projection arrives.
      queue.reset(batch.revision, {
        settings: settingsChange(next),
        ...(operatorReview && { instructions: latestInstructions(operatorReview)?.text ?? '' }),
      })
      reset(next)
      if (operatorReview) {
        instructionsTouched.current = false
        setInstructions(latestInstructions(operatorReview)?.text ?? '')
      }
    }
  }, [batch, composingText, operatorReview, queue, reset, state.dirty, state.revision])

  // The queue's connection gate: after a disconnect, current state is read before writes resume.
  useEffect(() => {
    if (!hasPorts) {
      return
    }
    if (!connected) {
      reconciled.current = false
      queue.setConnected(false)
      return
    }
    if (reconciled.current) {
      queue.setConnected(true)
      return
    }
    // A read that started before a later disconnect is dropped, and a fresh one is issued.
    let cancelled = false
    let retry: ReturnType<typeof setTimeout> | undefined
    latest.current.ports!.read().then(
      (snapshot) => {
        if (cancelled) {
          return
        }
        reconciled.current = true
        latest.current.ports?.accept(snapshot)
        queue.setConnected(true)
      },
      () => {
        if (!cancelled) {
          retry = setTimeout(() => setReadAttempt((value) => value + 1), RECONCILE_RETRY_MS)
        }
      },
    )
    return () => {
      cancelled = true
      clearTimeout(retry)
    }
  }, [connected, hasPorts, queue, readAttempt])

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
    instructionsTouched.current = true
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

  /**
   * Navigation hears new pending tag text synchronously. Clearing waits for the dirty effect, so
   * an unmounting input can never report the panel dirty after its owner reported clean.
   */
  function reportTagPending(pending: boolean) {
    setTagPending(pending)
    if (pending) {
      onDirty(true)
    }
  }

  function discardUnsent() {
    if (!queue.discardDrafts()) {
      return
    }
    setTagInput((value) => value + 1)
    reset(settingsValues(batch))
    instructionsTouched.current = false
    // The queue's acknowledged text can be newer than the last projection read.
    setInstructions(
      queue.savedValue<string>('instructions') ?? latestInstructions(operatorReview)?.text ?? '',
    )
    setLogo({ state: 'idle' })
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

  const [open, setOpen] = useState(false)
  const fields = useRef<HTMLFormElement>(null)
  const heading = useRef<HTMLHeadingElement>(null)
  const foldFocused = useRef(false)
  // Folding at the breakpoint must not hide the field being edited, so the fold opens instead.
  useEffect(() => {
    if (collapsible && fields.current?.contains(document.activeElement)) {
      setOpen(true)
    }
    // The fold button leaves with the phone layout; its focus moves to the plain heading.
    if (!collapsible && foldFocused.current && document.activeElement === document.body) {
      heading.current?.focus()
    }
    foldFocused.current = false
  }, [collapsible])
  const summary = settingsSummary(batch, values)
  const titleInvalid = !values.title.trim()
  const settingsStatus = laneState(state, 'settings')

  return (
    <Settings role="region" aria-labelledby="batch-settings-title" data-area="settings">
      <Head>
        {collapsible ? (
          <Heading id="batch-settings-title">
            <Fold
              type="button"
              onFocus={() => {
                foldFocused.current = true
              }}
              onBlur={(event) => {
                if (event.relatedTarget) {
                  foldFocused.current = false
                }
              }}
              aria-expanded={open}
              aria-controls="batch-settings-fields"
              onClick={() => setOpen(!open)}
            >
              Batch settings
              {summary.length > 0 && <Small as="span"> · {summary.join(' · ')}</Small>}
            </Fold>
          </Heading>
        ) : (
          <Heading id="batch-settings-title" ref={heading} tabIndex={-1}>
            Batch settings
          </Heading>
        )}
        <AutosaveStatus label="Batch settings" state={settingsStatus} revision={state.revision} />
      </Head>
      {!ports && (
        <div role="status">
          <Banner tone="plain">Settings editing is unavailable in this view.</Banner>
        </div>
      )}
      {ports && !connected && (
        <div role="status">
          <Banner tone="warn">
            Application connection unavailable. Settings are read-only until it returns; unsaved
            edits stay on this page.
          </Banner>
        </div>
      )}
      {paused && (
        <div role="status">
          <Banner tone="info">
            Finish or discard the evidence change to continue editing settings.
          </Banner>
        </div>
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
        <Button onClick={() => void keepEdits()}>
          Keep my edits and save them over the newer version
        </Button>
      )}
      {state.blocked === 'unconfirmed' && (
        <AutosaveStatus
          label="Batch settings"
          state="unconfirmed"
          revision={state.revision}
          onRetry={state.connected ? () => queue.retry() : undefined}
          onReload={reload}
        />
      )}
      {ports && !connected && (state.dirty || tagPending) && queue.canDiscardLocally() && (
        <Button onClick={discardUnsent}>Discard unsent settings edits</Button>
      )}
      <Form
        ref={fields}
        id="batch-settings-fields"
        hidden={collapsible && !open}
        onSubmit={(event) => event.preventDefault()}
        onBlur={flushAll}
        onCompositionStart={() => {
          composing.current = true
          setComposingText(true)
          queue.suspend()
        }}
        onCompositionEnd={(event) => {
          composing.current = false
          setComposingText(false)
          const target = event.target as HTMLElement
          if (target instanceof HTMLTextAreaElement && target.dataset.lane === 'instructions') {
            updateInstructions(target.value)
          } else {
            scheduleText()
          }
          queue.resume()
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
            render={({ field }) => {
              const notes = (
                <TextField
                  as="textarea"
                  label="Notes for the whole batch"
                  value={field.value ?? ''}
                  maxLength={8192}
                  disabled={!editable}
                  onChange={(event) => {
                    // An empty field removes the notes rather than saving blank text.
                    const value = event.target.value || null
                    field.onChange(value)
                    if (value === null) {
                      schedule()
                    } else {
                      scheduleText()
                    }
                  }}
                />
              )
              return notesTarget ? createPortal(notes, notesTarget) : notes
            }}
          />
          <DefaultLocationField
            batch={batch}
            value={values.defaultLocation}
            drafts={values.drafts}
            currentDrafts={() => getValues('drafts')}
            catalogue={locations}
            observe={observe}
            disabled={!editable}
            onChange={setLocation}
            onTextEdit={() => {
              textEdit.current = true
            }}
          />
          <LocationOverrides batch={batch} />
          <SupplierField
            batch={batch}
            value={values.intent.supplier}
            drafts={values.drafts}
            currentDrafts={() => getValues('drafts')}
            catalogue={suppliers}
            observe={observe}
            disabled={!editable}
            logo={shownLogo}
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
                key={tagInput}
                value={field.value}
                disabled={!editable}
                onPendingChange={reportTagPending}
                onChange={(value) => {
                  field.onChange(value)
                  schedule()
                }}
              />
            )}
          />
          {state.lanes.instructions && (
            <Instructions>
              <Label>
                Custom instructions
                <TextArea
                  data-lane="instructions"
                  value={instructions}
                  maxLength={MAX_INSTRUCTION_CHARACTERS * 2}
                  onChange={(event) => updateInstructions(event.target.value)}
                />
              </Label>
              <Small data-version={instructionRecord?.version}>
                {instructionRecord
                  ? `Saved ${new Date(instructionRecord.created_at).toLocaleString()}`
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
    </Settings>
  )
}

/** The phone summary: the chosen supplier and default location, as their pickers name them. */
function settingsSummary(batch: Snapshot, values: SettingsValues) {
  const draftName = (id: string) => values.drafts.find((draft) => draft.draft_id === id)?.value.name

  const parts: string[] = []
  const supplier = values.intent.supplier
  if (supplier.absent) {
    parts.push('No supplier')
  } else if (supplier.selection.mode === 'existing') {
    parts.push(referenceLabel(batch, supplier.selection.reference.observation_id))
  } else if (supplier.selection.mode === 'draft') {
    const name = draftName(supplier.selection.draft_id)
    if (name) {
      parts.push(name)
    }
  }
  const location = values.defaultLocation
  if (location.mode === 'set') {
    parts.push(referenceLabel(batch, location.value.observation_id))
  } else if (location.mode === 'draft') {
    const name = draftName(location.draft_id)
    if (name) {
      parts.push(name)
    }
  }
  return parts
}

/** One line naming the lots whose location differs from the default; Review holds the detail. */
function LocationOverrides({ batch }: { batch: Snapshot }) {
  const overrides = batch.lots.filter((lot) => !lot.retired && lot.location.mode !== 'inherit')
  if (!overrides.length) {
    return null
  }
  const lead =
    overrides.length === 1 ? '1 lot overrides this: ' : `${overrides.length} lots override this: `
  return (
    <Small>
      {lead}
      {overrides.map((lot, index) => (
        <span key={lot.id}>
          {index > 0 && (index === overrides.length - 1 ? ' and ' : ', ')}
          <Link href={batchHref(batch.id, { tab: 'review', view: 'lots', lotId: lot.id })}>
            {lot.label}
          </Link>
        </span>
      ))}
      .
    </Small>
  )
}

const Fold = styled.button`
  display: inline;
  padding: 0;
  border: 0;
  background: none;
  color: inherit;
  font: inherit;
  text-align: left;
  cursor: pointer;
  &::before {
    content: '▸ ';
  }
  &[aria-expanded='true']::before {
    content: '▾ ';
  }
  ${media.compact} {
    min-height: ${size.touch};
  }
`

const Head = styled.div`
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: ${space[4]};
  margin-bottom: ${space[6]};
  ${Heading} {
    margin: 0;
  }
`
const Settings = styled(Panel)`
  min-width: 0;
  margin-bottom: 0;
  form[hidden] {
    display: none;
  }
`
const Instructions = styled.div`
  display: grid;
  gap: ${space[4]};
  padding-top: ${space[6]};
  border-top: 1px solid ${color.line};
`
