import { createPortal } from 'react-dom'
import { useEffect, useRef, useState, type SyntheticEvent } from 'react'
import { Controller, useForm } from 'react-hook-form'
import styled from 'styled-components'
import type {
  MediaEditDto,
  MediaSnapshotDto,
  MediaVersionDto,
  RotatedMediaRecipeDto,
} from '@invimport/contracts'
import { Button, Heading, Paragraph, Small } from '../ui/primitives'
import { mediaResource } from '../../media/types'
import {
  cropRecipe,
  sameRotatedRecipe,
  type CropForm,
  type CropIntent,
} from '../../media/crop-model'
import { MediaCropFields } from './MediaCropFields'
import { RotatedCropSelection } from './RotatedCropSelection'

interface Props {
  batchId: string
  version: MediaVersionDto
  pageNumber: number
  revision: string
  snapshot: MediaSnapshotDto
  readUnavailable: boolean
  save: (input: MediaEditDto, key: string) => Promise<void>
  close: () => void
  onDirtyChange: (dirty: boolean) => void
}

export function MediaCropDialog({
  batchId,
  version,
  pageNumber,
  revision,
  snapshot,
  readUnavailable,
  save,
  close,
  onDirtyChange,
}: Props) {
  const page = version.pages.find((item) => item.page === pageNumber)!
  const dialog = useRef<HTMLDialogElement>(null)
  const intent = useRef<CropIntent | null>(null)
  const draftRevision = useRef(revision)
  const [submitted, setSubmitted] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const { control, watch, setValue, handleSubmit } = useForm<CropForm>({
    defaultValues: {
      frame: {
        centerX: page.width / 2,
        centerY: page.height / 2,
        width: page.width * 0.6,
        height: page.height * 0.6,
        degrees: 0,
      },
      aspect: 'free',
    },
  })
  const frame = watch('frame')
  const aspect = watch('aspect')
  const locked = intent.current !== null
  let currentRecipe: RotatedMediaRecipeDto | null = null
  try {
    currentRecipe = cropRecipe(version, pageNumber, frame, aspect)
  } catch {
    // Invalid numeric input remains visible until the user corrects it.
  }

  useEffect(() => {
    dialog.current?.showModal()
    onDirtyChange(true)
    return () => onDirtyChange(false)
  }, [onDirtyChange])

  async function prepare() {
    if (!currentRecipe) {
      return
    }
    if (!intent.current) {
      const derivationId = crypto.randomUUID()
      intent.current = {
        key: crypto.randomUUID(),
        derivationId,
        recipe: currentRecipe,
        input: {
          expected_revision: draftRevision.current,
          change: {
            kind: 'derive',
            evidence_id: version.evidence_id,
            derivation_id: derivationId,
            recipe: currentRecipe,
          },
        },
      }
    }
    setBusy(true)
    setError('')
    try {
      await save(intent.current.input, intent.current.key)
      setSubmitted(true)
    } catch {
      setError(
        'Preparation was not confirmed. Retry preserves this exact recipe, request key and derivation ID; editing remains locked.',
      )
    } finally {
      setBusy(false)
    }
  }

  function reconcileNativeClose(event: SyntheticEvent<HTMLDialogElement>) {
    const nativeDialog = event.currentTarget
    if (!nativeDialog.isConnected || nativeDialog.open) {
      return
    }

    const unconfirmedRequest = intent.current !== null && !submitted
    if (!busy && !unconfirmedRequest) {
      close()
      return
    }

    // A repeated platform close request can bypass cancel.preventDefault().
    // Keep the same pending/uncertain intent reachable until explicit discard.
    try {
      nativeDialog.showModal()
    } catch {
      nativeDialog.open = true
      setError(
        'Your crop request is preserved, but the modal view could not be restored. Retry the exact request or discard it when the controls become available.',
      )
    }
  }

  const retained = snapshot.derivations.find((item) => item.id === intent.current?.derivationId)
  const output = snapshot.evidence
    .find((item) => item.id === version.evidence_id)
    ?.versions.find((item) => item.id === retained?.version_id)
  const retainedRecipeMatches =
    retained?.recipe.version === 'documentary-rotated-region/1' &&
    intent.current &&
    sameRotatedRecipe(retained.recipe, intent.current.recipe)
  const outputRecipeMatches =
    output?.recipe?.version === 'documentary-rotated-region/1' &&
    intent.current &&
    sameRotatedRecipe(output.recipe, intent.current.recipe)
  const outputPage =
    retainedRecipeMatches && outputRecipeMatches && output.state === 'ready'
      ? output.pages[0]
      : null

  return createPortal(
    <Dialog
      ref={dialog}
      aria-labelledby="crop-title"
      onCancel={(event) => event.preventDefault()}
      onClose={reconcileNativeClose}
    >
      <Heading id="crop-title">Prepare documentary crop</Heading>
      <Paragraph>
        Drag the crop box. Resize at a corner; drag just outside a corner to rotate the box. The
        source image stays fixed.
      </Paragraph>
      <CropBody>
        <SelectionEditor>
          <Controller
            name="frame"
            control={control}
            render={({ field }) => (
              <RotatedCropSelection
                source={mediaResource(batchId, 'previews', page.preview_id)}
                sourceWidth={page.width}
                sourceHeight={page.height}
                frame={field.value}
                aspect={aspect}
                disabled={locked || busy || readUnavailable}
                change={field.onChange}
              />
            )}
          />
          <form onSubmit={handleSubmit(prepare)}>
            <MediaCropFields
              control={control}
              setValue={setValue}
              width={frame.width}
              aspect={aspect}
              disabled={locked || busy || readUnavailable}
            />
            {!currentRecipe && (
              <Paragraph role="alert">
                Keep a positive crop with all four rotated corners inside the source image.
              </Paragraph>
            )}
            {readUnavailable && (
              <Paragraph role="alert">
                Current saved media is unavailable. The crop request is preserved and preparation is
                blocked.
              </Paragraph>
            )}
            {error && <Paragraph role="alert">{error}</Paragraph>}
            <Actions>
              <Button type="button" disabled={busy} onClick={close}>
                {submitted ? 'Close prepared crop' : 'Discard and close'}
              </Button>
              {!submitted && (
                <Button disabled={busy || readUnavailable || !currentRecipe}>
                  {busy
                    ? 'Retaining crop request…'
                    : locked
                      ? 'Retry exact preparation request'
                      : 'Prepare new version'}
                </Button>
              )}
              {submitted && (
                <Button
                  type="button"
                  disabled={readUnavailable}
                  onClick={() => {
                    intent.current = null
                    draftRevision.current = snapshot.revision
                    setSubmitted(false)
                  }}
                >
                  Edit another crop
                </Button>
              )}
            </Actions>
          </form>
        </SelectionEditor>
        <Output aria-labelledby="crop-output-title">
          <Heading id="crop-output-title">Prepared output</Heading>
          {outputPage ? (
            <img
              src={mediaResource(batchId, 'previews', outputPage.preview_id)}
              alt="Retained output for this exact rotated crop"
            />
          ) : (
            <Paragraph>
              {submitted
                ? `Exact crop preparation: ${retained?.state ?? 'waiting for retained receipt'}.`
                : 'Prepare this crop to see its retained server output.'}
            </Paragraph>
          )}
          {retained && !retainedRecipeMatches && (
            <Paragraph role="alert">
              The retained recipe does not match this request. Output is blocked.
            </Paragraph>
          )}
          <Small>
            Source {page.width} × {page.height}. Prepared output uses the pinned server decoder; the
            original stays unchanged.
          </Small>
        </Output>
      </CropBody>
    </Dialog>,
    document.body,
  )
}

const Dialog = styled.dialog`
  width: min(1400px, calc(100vw - 32px));
  max-height: calc(100dvh - 32px);
  overflow: auto;
  border: 1px solid #bac7d8;
  border-radius: 8px;
  padding: 20px;
  background: #fff;
  &::backdrop {
    background: rgb(20 35 55 / 40%);
  }
`
const CropBody = styled.div`
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(250px, 0.42fr);
  gap: 20px;
  align-items: start;
  @media (max-width: 760px) {
    grid-template-columns: minmax(0, 1fr);
  }
`
const SelectionEditor = styled.div`
  min-width: 0;
  fieldset {
    border: 0;
    padding: 0;
    margin: 0;
  }
`
const Actions = styled.div`
  display: flex;
  gap: 10px;
  flex-wrap: wrap;
  margin: 16px 0;
`
const Output = styled.section`
  border-left: 1px solid #d5dce5;
  padding-left: 20px;
  @media (max-width: 760px) {
    border-left: 0;
    border-top: 1px solid #d5dce5;
    padding: 16px 0 0;
  }
  img {
    display: block;
    max-width: 100%;
    max-height: 360px;
    margin-bottom: 12px;
  }
`
