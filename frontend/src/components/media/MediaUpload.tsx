import { useImperativeHandle, useRef, type Ref } from 'react'
import styled from 'styled-components'
import { space } from '#/theme/generated/tokens'
import { Small } from '#/components/ui'
import { CaptureActions } from '#/components/capture/CaptureActions'
import type { UploadKind, UploadQueue } from '#/media/useUploadQueue'

export type EvidenceUploadHandle = {
  choose: (kind: UploadKind, groupId?: string) => void
}
interface Props {
  ref?: Ref<EvidenceUploadHandle>
  chooseDisabled: boolean
  noteDisabled: boolean
  onWriteNote?: () => void
  queue: Pick<UploadQueue, 'add'>
}

/** Picked files upload at once; their tiles show in the target group's grid. */
export function MediaUpload({ ref, chooseDisabled, noteDisabled, onWriteNote, queue }: Props) {
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
