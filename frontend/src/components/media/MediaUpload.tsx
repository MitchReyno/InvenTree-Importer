import { useImperativeHandle, useRef, useState, type Ref } from 'react'
import styled from 'styled-components'
import type { MediaReceiptDto } from '@invimport/contracts'
import { Button, Paragraph, Small } from '../ui/primitives'
import { EvidenceActions } from './EvidenceActions'

export type EvidenceUploadHandle = {
  choose: (kind: 'photos' | 'document', groupId?: string) => void
}
type Pending = { file: File; key: string; revision: string; groupId?: string }
interface Props {
  ref?: Ref<EvidenceUploadHandle>
  disabled: boolean
  chooseDisabled: boolean
  noteDisabled: boolean
  onWriteNote?: () => void
  revision: string
  onDirtyChange: (dirty: boolean) => void
  upload: (file: File, key: string, revision: string) => Promise<MediaReceiptDto>
  finish: (receipt: MediaReceiptDto, groupId?: string) => Promise<void>
}

export function MediaUpload({
  ref,
  disabled,
  chooseDisabled,
  noteDisabled,
  onWriteNote,
  revision,
  upload,
  finish,
  onDirtyChange,
}: Props) {
  const photos = useRef<HTMLInputElement>(null)
  const document = useRef<HTMLInputElement>(null)
  const destination = useRef<string | undefined>(undefined)
  const [pending, setPending] = useState<Pending | null>(null)
  const [receipt, setReceipt] = useState<MediaReceiptDto | null>(null)
  const [unfinished, setUnfinished] = useState<{
    receipt: MediaReceiptDto
    groupId?: string
  } | null>(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  function choose(kind: 'photos' | 'document', groupId?: string) {
    if (chooseDisabled || pending || unfinished || busy) {
      return
    }
    destination.current = groupId
    const input = kind === 'photos' ? photos.current : document.current
    if (input) {
      input.value = ''
      input.click()
    }
  }

  useImperativeHandle(ref, () => ({ choose }))

  function selected(file: File | undefined, kind: 'photos' | 'document') {
    // Not gated on `disabled`: the picker's return of focus briefly re-reads the batch. Retain stays gated.
    if (!file || pending || unfinished) {
      return
    }
    const allowed = kind === 'photos' ? ['image/jpeg', 'image/png'] : ['application/pdf']
    if (!allowed.includes(file.type) || !file.size || file.size > 20 * 1024 * 1024) {
      setError('Choose a nonempty JPEG or PNG photo, or a PDF document, up to 20 MiB.')
      return
    }
    onDirtyChange(true)
    setPending({ file, key: crypto.randomUUID(), revision, groupId: destination.current })
    setReceipt(null)
    setError('')
  }

  async function finishRead(value: { receipt: MediaReceiptDto; groupId?: string }) {
    try {
      await finish(value.receipt, value.groupId)
      setUnfinished(null)
      onDirtyChange(false)
    } catch {
      setUnfinished(value)
      setError(
        'Original retained. Current membership could not be read; retry the read. Do not upload the original again.',
      )
    }
  }

  async function retainSelected() {
    if (!pending || disabled || busy) {
      return
    }
    setBusy(true)
    setError('')
    let retained: MediaReceiptDto
    try {
      retained = await upload(pending.file, pending.key, pending.revision)
    } catch {
      setError(
        'Retention was not confirmed. The selected file, revision and request key are preserved for an exact retry.',
      )
      setBusy(false)
      return
    }
    setReceipt(retained)
    setPending(null)
    const next = { receipt: retained, groupId: pending.groupId }
    setUnfinished(next)
    await finishRead(next)
    setBusy(false)
  }

  return (
    <UploadArea>
      <EvidenceActions
        mediaDisabled={chooseDisabled || !!pending || !!unfinished || busy}
        noteDisabled={noteDisabled}
        writeNote={onWriteNote}
        takePhotos={() => choose('photos')}
        addDocument={() => choose('document')}
      />
      <input
        ref={photos}
        hidden
        aria-label="Choose photos"
        type="file"
        accept="image/jpeg,image/png"
        capture="environment"
        disabled={chooseDisabled || !!pending || !!unfinished || busy}
        onChange={(event) => selected(event.target.files?.[0], 'photos')}
      />
      <input
        ref={document}
        hidden
        aria-label="Choose document"
        type="file"
        accept="application/pdf"
        disabled={chooseDisabled || !!pending || !!unfinished || busy}
        onChange={(event) => selected(event.target.files?.[0], 'document')}
      />
      <Small>JPEG, PNG or PDF · up to 20 MiB each. Originals stay private and unchanged.</Small>
      {pending && (
        <>
          <Paragraph>
            Selected: {pending.file.name}
            {pending.groupId
              ? ' · destination selected; membership is saved after original retention.'
              : ''}
          </Paragraph>
          <Button disabled={disabled || busy} onClick={() => void retainSelected()}>
            {busy ? 'Retaining original…' : `Retain ${pending.file.name}`}
          </Button>
          <Button
            disabled={busy}
            onClick={() => {
              setPending(null)
              onDirtyChange(false)
            }}
          >
            Discard selected file
          </Button>
        </>
      )}
      {receipt && (
        <Paragraph role="status">
          Original retained · {receipt.version.byte_size} bytes. Preview preparation is separate.
        </Paragraph>
      )}
      {unfinished && !busy && (
        <Button
          disabled={disabled}
          onClick={() => {
            setBusy(true)
            void finishRead(unfinished).finally(() => setBusy(false))
          }}
        >
          Retry saved membership read
        </Button>
      )}
      {error && <Paragraph role="alert">{error}</Paragraph>}
    </UploadArea>
  )
}

const UploadArea = styled.div`
  display: grid;
  gap: 10px;
  margin-bottom: 16px;
  min-width: 0;
  p {
    overflow-wrap: anywhere;
  }
`
