import { useImperativeHandle, useRef, type Ref } from 'react'
import styled from 'styled-components'
import { space } from '#/theme/generated/tokens'
import { Small } from '#/components/ui'
import { CaptureActions } from '#/components/capture/CaptureActions'
import type { UploadKind, UploadQueue } from '#/media/useUploadQueue'
import { UploadQueueItem } from './UploadQueueItem'

export type EvidenceUploadHandle = {
  choose: (kind: UploadKind, groupId?: string) => void
}
interface Props {
  ref?: Ref<EvidenceUploadHandle>
  /** Retry and read-again wait while media commands are unavailable. */
  disabled: boolean
  chooseDisabled: boolean
  noteDisabled: boolean
  onWriteNote?: () => void
  queue: UploadQueue
}

/** Picked files upload at once; the queue owns their requests and per-file states. */
export function MediaUpload({
  ref,
  disabled,
  chooseDisabled,
  noteDisabled,
  onWriteNote,
  queue,
}: Props) {
  const photos = useRef<HTMLInputElement>(null)
  const document = useRef<HTMLInputElement>(null)
  const destination = useRef<string | undefined>(undefined)

  function choose(kind: UploadKind, groupId?: string) {
    if (chooseDisabled) {
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

  // Files already in their group only count towards progress.
  const shown = queue.items.filter((item) => item.status !== 'done')

  // Not gated on `disabled`: the picker's return of focus briefly re-reads the batch.
  function selected(files: FileList | null, kind: UploadKind) {
    queue.add([...(files ?? [])], kind, destination.current)
  }

  return (
    <UploadArea>
      <CaptureActions
        mediaDisabled={chooseDisabled}
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
        multiple
        accept="image/jpeg,image/png"
        capture="environment"
        disabled={chooseDisabled}
        onChange={(event) => selected(event.target.files, 'photos')}
      />
      <input
        ref={document}
        hidden
        aria-label="Choose document"
        type="file"
        multiple
        accept="application/pdf"
        disabled={chooseDisabled}
        onChange={(event) => selected(event.target.files, 'document')}
      />
      <Small>JPEG, PNG or PDF · up to 20 MiB each. Originals stay private and unchanged.</Small>
      {shown.length > 0 && (
        <Uploads aria-label="Uploads" aria-live="polite">
          {shown.map((item) => (
            <UploadQueueItem
              key={item.id}
              item={item}
              disabled={disabled}
              onRetry={() => queue.retry(item.id)}
              onReadAgain={() => queue.readAgain(item.id)}
              onDismiss={() => queue.dismiss(item.id)}
            />
          ))}
        </Uploads>
      )}
    </UploadArea>
  )
}

const UploadArea = styled.div`
  display: grid;
  gap: ${space[5]};
  min-width: 0;
  p {
    overflow-wrap: anywhere;
  }
`
const Uploads = styled.ul`
  display: grid;
  gap: ${space[3]};
  margin: 0;
  padding: 0;
  list-style: none;
  min-width: 0;
`
