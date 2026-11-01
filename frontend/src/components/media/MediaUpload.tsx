import { useState } from 'react'
import styled from 'styled-components'
import type { MediaReceiptDto } from '@invimport/contracts'
import { Button, Paragraph, Small } from '../ui/primitives'

interface Props {
  disabled: boolean
  revision: string
  onDirtyChange: (dirty: boolean) => void
  upload: (file: File, key: string, revision: string) => Promise<MediaReceiptDto>
  refresh: () => Promise<void>
}

export function MediaUpload({ disabled, revision, upload, refresh, onDirtyChange }: Props) {
  const [pending, setPending] = useState<{ file: File; key: string; revision: string } | null>(null)
  const [receipt, setReceipt] = useState<MediaReceiptDto | null>(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  async function retainSelected() {
    if (!pending) {
      return
    }
    setBusy(true)
    setError('')
    try {
      const retained = await upload(pending.file, pending.key, pending.revision)
      setReceipt(retained)
      setPending(null)
      onDirtyChange(false)
    } catch {
      setError(
        'Retention was not confirmed. Refresh saved evidence before deciding whether to resubmit. The selected file and request key are preserved here.',
      )
      setBusy(false)
      return
    }
    try {
      await refresh()
    } catch {
      setError(
        'The original is retained, but saved evidence could not be refreshed. Keep the receipt and retry the read.',
      )
    } finally {
      setBusy(false)
    }
  }

  return (
    <UploadArea>
      <label>
        Add a photo or PDF
        <input
          type="file"
          accept="image/jpeg,image/png,application/pdf"
          disabled={disabled || busy}
          onChange={(event) => {
            const file = event.target.files?.[0]
            onDirtyChange(Boolean(file))
            setPending(file ? { file, key: crypto.randomUUID(), revision } : null)
            setReceipt(null)
            setError('')
          }}
        />
      </label>
      <Small>JPEG, PNG or PDF · up to 20 MiB. Originals stay private and unchanged.</Small>
      {pending && (
        <>
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
      {error && <Paragraph role="alert">{error}</Paragraph>}
    </UploadArea>
  )
}

const UploadArea = styled.div`
  display: grid;
  gap: 10px;
  margin-bottom: 16px;

  label {
    display: grid;
    gap: 8px;
    font-weight: 600;
  }

  input {
    max-width: 100%;
  }
`
