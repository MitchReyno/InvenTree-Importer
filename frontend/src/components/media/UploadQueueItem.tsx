import styled from 'styled-components'
import { color, space, type } from '#/theme/generated/tokens'
import { Button, Spinner } from '#/components/ui'
import type { UploadItem } from '#/media/useUploadQueue'

type Props = {
  item: UploadItem
  /** Retry and read-again wait for a current read; Dismiss never sends anything. */
  disabled: boolean
  onRetry: () => void
  onReadAgain: () => void
  onDismiss: () => void
}

function statusText(item: UploadItem) {
  switch (item.status) {
    case 'waiting':
    case 'uploading':
      return 'Uploading…'
    case 'preparing':
    case 'done':
      return 'Preparing…'
    case 'not_added':
      return `Not added. ${item.reason ?? ''}`.trim()
    case 'unconfirmed':
      return 'Upload not confirmed. Retry sends the same request, so it cannot be added twice.'
    case 'unread':
      return 'Added. The current evidence could not be read; read it again rather than uploading.'
    case 'ungrouped':
      return 'Added to Ungrouped. Moving it into its group was not confirmed.'
  }
}

/** One picked file's upload state; fetch reports no byte progress, so uploading is indeterminate. */
export function UploadQueueItem({ item, disabled, onRetry, onReadAgain, onDismiss }: Props) {
  const working = ['waiting', 'uploading', 'preparing', 'done'].includes(item.status)
  const failed = item.status === 'not_added' || item.status === 'unconfirmed'

  return (
    <Row aria-label={item.name}>
      {working && <Spinner />}
      <Name>{item.name}</Name>
      <Status $failed={failed}>{statusText(item)}</Status>
      {item.status === 'unconfirmed' && (
        <Button size="sm" disabled={disabled} aria-label={`Retry ${item.name}`} onClick={onRetry}>
          Retry
        </Button>
      )}
      {item.status === 'unread' && (
        <Button
          size="sm"
          disabled={disabled}
          aria-label={`Read ${item.name} again`}
          onClick={onReadAgain}
        >
          Read again
        </Button>
      )}
      {(item.status === 'not_added' || item.status === 'ungrouped') && (
        <Button size="sm" variant="ghost" aria-label={`Dismiss ${item.name}`} onClick={onDismiss}>
          Dismiss
        </Button>
      )}
    </Row>
  )
}

const Row = styled.li`
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: ${space[3]};
  min-width: 0;
`
const Name = styled.span`
  ${type.bodyStrong}
  overflow-wrap: anywhere;
`
const Status = styled.span<{ $failed: boolean }>`
  flex: 1 1 12rem;
  color: ${({ $failed }) => ($failed ? color.bad : color.muted)};
`
