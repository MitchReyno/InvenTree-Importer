import type { MediaEvidenceDto, MediaVersionDto } from '@invimport/contracts'
import { previewImage } from '../../media/images'
import { EvidenceTile, type PreviewState } from '../ui/EvidenceTile'

type EvidenceFileTileProps = {
  batchId: string
  evidence: MediaEvidenceDto
  /** The file's distinguishing name when two files share a label. */
  name: string
  /** What the file supports, such as "2 lots". */
  support: string
  selectable: boolean
  selected: boolean
  onSelect: (selected: boolean) => void
  onOpen: () => void
}

/** A ready crop shows in place of its original; otherwise the newest version decides. */
function shownVersion(evidence: MediaEvidenceDto): MediaVersionDto | undefined {
  const ready = evidence.versions.filter((version) => version.state === 'ready')
  return (
    ready.findLast((version) => version.kind === 'derived') ??
    ready.find((version) => version.kind === 'original') ??
    evidence.versions.at(-1)
  )
}

function previewState(version: MediaVersionDto | undefined): PreviewState {
  if (!version || version.state === 'queued') {
    return 'preparing'
  }

  return version.state === 'ready' ? 'ready' : 'failed'
}

/** One evidence file on Capture; crop, rotation, download and identity are in its viewer. */
export function EvidenceFileTile(props: EvidenceFileTileProps) {
  const { batchId, evidence, name } = props
  const version = shownVersion(evidence)
  const page = version?.state === 'ready' ? version.pages[0] : undefined

  return (
    <EvidenceTile
      preview={
        page ? previewImage(batchId, page, 'card', '(max-width: 700px) 50vw, 240px') : undefined
      }
      name={name}
      support={props.support}
      note={evidence.note?.text}
      kind={version?.media_type === 'application/pdf' ? 'document' : 'photo'}
      state={previewState(version)}
      selectable={props.selectable}
      selected={props.selected}
      onSelect={props.onSelect}
      onOpen={props.onOpen}
    />
  )
}
